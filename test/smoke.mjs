#!/usr/bin/env node
/**
 * VishRouter end-to-end smoke test.
 *
 * Boots the *real* gateway (`node src/index.js`) as a child process against
 * throwaway mock providers, then drives it over HTTP through the full matrix:
 * routing, equivalence, failover, streaming, and every error path.
 *
 * Needs no API keys and makes no external network calls:
 *
 *   npm run smoke
 *
 * To exercise real providers instead, put a key in .env and run:
 *
 *   npm run smoke:live
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = process.argv.includes('--live');

// ------------------------------------------------------------ tiny reporter

const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  results.push({ name, ok, detail });
  const mark = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${mark}  ${name}${ok ? '' : `\n          ${detail}`}`);
  return ok;
}

function equal(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  return check(name, a === e, `expected ${e}, got ${a}`);
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

// ------------------------------------------------------------- mock upstreams

/** Mutable per-provider behaviour so scenarios can be driven from the test. */
const mode = { openai: 'ok', deepseek: 'ok', anthropic: 'ok' };

function startMock(handler) {
  const captured = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
    captured.push({ path: req.url, headers: req.headers, body });
    await handler(req, res, body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        captured,
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
      })
    );
  });
}

const sse = (res, obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

/** OpenAI-shaped upstream (used for both the openai and deepseek slots). */
const openAiShaped = (name, label) => (req, res, body) => {
  const behaviour = mode[name];

  if (behaviour === '429') {
    res.writeHead(429, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: `${label} simulated rate limit`, type: 'rate_limit_error' } }));
  }
  if (behaviour === '500') {
    res.writeHead(500, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: `${label} simulated outage` } }));
  }
  if (behaviour === '400') {
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'invalid parameter value' } }));
  }

  if (body.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const base = { id: 'chunk-1', object: 'chat.completion.chunk', created: 1, model: body.model };

    if (behaviour === 'die-mid-stream') {
      sse(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'Partial ' }, finish_reason: null }] });
      setTimeout(() => res.socket?.destroy(), 40); // kill the socket mid-stream
      return;
    }

    sse(res, { ...base, choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello ' }, finish_reason: null }] });
    sse(res, { ...base, choices: [{ index: 0, delta: { content: `from ${label}` }, finish_reason: null }] });
    sse(res, { ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    sse(res, { ...base, choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } });
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      id: 'chatcmpl-mock',
      object: 'chat.completion',
      created: 1,
      model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: `Hello from ${label}` }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
    })
  );
};

/** Anthropic-shaped upstream: a genuinely different wire format. */
const anthropicShaped = (req, res, body) => {
  if (mode.anthropic === '429') {
    res.writeHead(429, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: { message: 'Anthropic simulated rate limit' } }));
  }

  if (body.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const event = (name, data) => res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    event('message_start', { message: { id: 'msg_1', model: body.model, usage: { input_tokens: 5 } } });
    event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Hello ' } });
    event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'from Claude' } });
    event('content_block_stop', { index: 0 });
    event('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 6 } });
    event('message_stop', {});
    return res.end();
  }

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [{ type: 'text', text: 'Hello from Claude' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 6 },
    })
  );
};

// ------------------------------------------------------------- gateway child

async function spawnGateway(env = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const state = { child, output: '', base: null };
  child.stdout.on('data', (chunk) => { state.output += String(chunk); });
  child.stderr.on('data', (chunk) => { state.output += String(chunk); });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`gateway did not report a listening port within 10s:\n${state.output}`)),
      10_000
    );
    const inspect = () => {
      const match = state.output.match(/listening on http:\/\/([^:]+):(\d+)/);
      if (match) {
        state.base = `http://${match[1]}:${match[2]}`;
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', inspect);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`gateway exited early with code ${code}:\n${state.output}`));
    });
  });

  // The listening line and the rest of the banner are separate writes, so give
  // the remaining lines a moment to flush before anyone asserts on them.
  await sleep(150);

  return state;
}

// -------------------------------------------------------------- http helpers

const postJson = (base, payload) =>
  fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });

/** Read an SSE response into its raw `data:` payloads. */
async function readSSE(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const frames = [];
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      for (const line of block.split('\n')) {
        if (line.startsWith('data:')) frames.push(line.slice(5).trim());
      }
    }
  }
  return frames;
}

const chunksOf = (frames) =>
  frames
    .filter((frame) => frame !== '[DONE]')
    .map((frame) => { try { return JSON.parse(frame); } catch { return null; } })
    .filter(Boolean);

const textOf = (frames) => chunksOf(frames).map((c) => c.choices?.[0]?.delta?.content ?? '').join('');
const finishOf = (frames) => chunksOf(frames).find((c) => c.choices?.[0]?.finish_reason)?.choices[0].finish_reason;
const usageOf = (frames) => chunksOf(frames).reverse().find((c) => c.usage)?.usage;

// =========================================================== offline suite

async function offlineSuite() {
  console.log('\x1b[1mVishRouter smoke test — mock providers (no API keys, no network)\x1b[0m');

  const openai = await startMock(openAiShaped('openai', 'OpenAI'));
  const deepseek = await startMock(openAiShaped('deepseek', 'DeepSeek'));
  const anthropic = await startMock(anthropicShaped);

  const config = {
    defaults: {
      timeoutMs: 5000,
      streamTimeoutMs: 5000,
      maxTokensWhenUnspecified: 4096,
      allowCrossProviderFallback: true,
      fallbackOn: { statuses: [408, 409, 429, 500, 502, 503, 504, 529], networkErrors: true, timeouts: true },
    },
    providers: {
      openai: { enabled: true, label: 'OpenAI', adapter: 'openai-compatible', baseUrl: openai.url, path: '/chat/completions', apiKeyEnv: 'OPENAI_API_KEY', auth: { type: 'bearer' }, defaultModel: 'gpt-4o-mini', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'], modelPrefixes: ['gpt-'], timeoutMs: 5000 },
      deepseek: { enabled: true, label: 'DeepSeek', adapter: 'openai-compatible', baseUrl: deepseek.url, path: '/chat/completions', apiKeyEnv: 'DEEPSEEK_API_KEY', auth: { type: 'bearer' }, defaultModel: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'], modelPrefixes: ['deepseek-'], timeoutMs: 5000 },
      anthropic: { enabled: true, label: 'Anthropic', adapter: 'anthropic', baseUrl: anthropic.url, path: '/messages', apiKeyEnv: 'ANTHROPIC_API_KEY', auth: { type: 'x-api-key' }, headers: { 'anthropic-version': '2023-06-01' }, defaultModel: 'claude-3-5-haiku-20241022', models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'], modelPrefixes: ['claude-'], maxTokensWhenUnspecified: 4096, timeoutMs: 5000 },
    },
    modelEquivalents: {
      'gpt-3.5-turbo': { openai: 'gpt-3.5-turbo', deepseek: 'deepseek-chat', anthropic: 'claude-3-5-haiku-20241022' },
      'gpt-4o-mini': { openai: 'gpt-4o-mini', deepseek: 'deepseek-chat', anthropic: 'claude-3-5-haiku-20241022' },
      'deepseek-chat': { openai: 'gpt-4o-mini', deepseek: 'deepseek-chat', anthropic: 'claude-3-5-haiku-20241022' },
      'claude-3-5-haiku-20241022': { openai: 'gpt-4o-mini', deepseek: 'deepseek-chat', anthropic: 'claude-3-5-haiku-20241022' },
    },
    fallbackOrder: ['openai', 'deepseek', 'anthropic'],
  };

  const configPath = path.join(os.tmpdir(), `vish-router-smoke-${Date.now()}.json`);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  let gateway;
  const ask = (payload) => postJson(gateway.base, payload);
  const message = (model, extra = {}) => ({ model, messages: [{ role: 'user', content: 'hi' }], ...extra });

  try {
    gateway = await spawnGateway({
      PORT: '0',
      HOST: '127.0.0.1',
      LOG_LEVEL: 'info',
      VISHROUTER_CONFIG: configPath,
      OPENAI_API_KEY: 'smoke-openai',
      DEEPSEEK_API_KEY: 'smoke-deepseek',
      ANTHROPIC_API_KEY: 'smoke-anthropic',
    });

    section('Boot and discovery');
    check('gateway boots and reports a listening URL', Boolean(gateway.base));
    check('banner names all providers', /providers: openai, deepseek, anthropic/.test(gateway.output));
    check('banner shows failover order', /failover: openai -> deepseek -> anthropic/.test(gateway.output));

    const health = await (await fetch(`${gateway.base}/health`)).json();
    equal('health reports ok', health.status, 'ok');
    equal('all three providers available', health.available_providers, 3);
    equal('fallback order echoed by health', health.fallback_order, ['openai', 'deepseek', 'anthropic']);

    const models = await (await fetch(`${gateway.base}/v1/models`)).json();
    const modelIds = models.data.map((m) => m.id);
    check('models endpoint lists known models', modelIds.length >= 7, `got ${modelIds.length}`);
    check('models include a native id', modelIds.includes('gpt-4o-mini'), modelIds.join(', '));

    section('Routing and equivalence');
    {
      const response = await ask(message('gpt-4o-mini'));
      const body = await response.json();
      equal('status', response.status, 200);
      equal('served by the native provider', response.headers.get('x-vishrouter-provider'), 'openai');
      equal('no fallback used', response.headers.get('x-vishrouter-fallback-used'), 'false');
      equal('content', body.choices[0].message.content, 'Hello from OpenAI');
      equal('model echoed to the client', body.model, 'gpt-4o-mini');
    }

    section('Failover and model translation');
    {
      mode.openai = '429';
      const response = await ask(message('gpt-3.5-turbo'));
      const body = await response.json();
      equal('429 on the primary fails over', response.headers.get('x-vishrouter-provider'), 'deepseek');
      equal('equivalence map picks the right model', response.headers.get('x-vishrouter-upstream-model'), 'deepseek-chat');
      equal('resolution path recorded', response.headers.get('x-vishrouter-model-resolved-via'), 'equivalence');
      equal('client still sees its own model', body.model, 'gpt-3.5-turbo');
      equal('content came from the fallback', body.choices[0].message.content, 'Hello from DeepSeek');
      equal('upstream received the translated model', deepseek.captured.at(-1).body.model, 'deepseek-chat');
      mode.openai = 'ok';
    }

    {
      mode.openai = '429';
      mode.deepseek = '500';
      const response = await ask({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'system', content: 'Be terse.' }, { role: 'user', content: 'hi' }],
      });
      const body = await response.json();
      equal('double failover reaches the third provider', response.headers.get('x-vishrouter-provider'), 'anthropic');
      equal('three attempts recorded', response.headers.get('x-vishrouter-attempts'), '3');
      equal('Anthropic content blocks flattened', body.choices[0].message.content, 'Hello from Claude');
      equal('usage translated to OpenAI shape', body.usage, { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 });
      equal('system message lifted to the top level', anthropic.captured.at(-1).body.system, 'Be terse.');
      equal('max_tokens injected (Anthropic requires it)', anthropic.captured.at(-1).body.max_tokens, 4096);
      mode.openai = 'ok';
      mode.deepseek = 'ok';
    }

    section('Error paths');
    {
      const invalid = await ask({ model: 'gpt-4o-mini', messages: [] });
      const body = await invalid.json();
      equal('validation failure is a 400', invalid.status, 400);
      equal('error envelope type', body.error.type, 'invalid_request_error');
      equal('error names the offending field', body.error.param, 'messages');

      const unknown = await ask(message('llama-3-unknown'));
      const unknownBody = await unknown.json();
      equal('unknown model is a 404', unknown.status, 404);
      equal('unknown model code', unknownBody.error.code, 'model_not_found');

      const malformed = await postJson(gateway.base, '{ "model": "gpt-4o-mini", ');
      equal('malformed JSON is a 400', malformed.status, 400);
      equal('malformed JSON code', (await malformed.json()).error.code, 'invalid_json');

      const missing = await fetch(`${gateway.base}/not-a-route`);
      equal('unknown endpoint is a 404', missing.status, 404);

      mode.openai = '429';
      mode.deepseek = '429';
      mode.anthropic = '429';
      const down = await ask(message('gpt-4o-mini'));
      const downBody = await down.json();
      equal('total outage surfaces the real status', down.status, 429);
      equal('total outage code', downBody.error.code, 'all_providers_failed');
      equal('every attempt reported', downBody.error.provider_attempts.length, 3);
      equal('provider 400 does not fail over', (await (async () => {
        mode.openai = '400';
        mode.deepseek = '429';
        mode.anthropic = '429';
        const before = deepseek.captured.length;
        const response = await ask(message('gpt-4o-mini'));
        const noFallback = deepseek.captured.length === before;
        return response.status === 400 && noFallback;
      })()), true);
      mode.openai = 'ok';
      mode.deepseek = 'ok';
      mode.anthropic = 'ok';
    }

    section('Streaming');
    {
      const response = await ask(message('gpt-4o-mini', { stream: true }));
      const frames = await readSSE(response);
      equal('stream status', response.status, 200);
      equal('content type', response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
      equal('provider header on a stream', response.headers.get('x-vishrouter-provider'), 'openai');
      equal('exactly one terminator', frames.filter((f) => f === '[DONE]').length, 1);
      equal('[DONE] comes last', frames.at(-1), '[DONE]');
      equal('assembled text', textOf(frames), 'Hello from OpenAI');
      equal('finish reason', finishOf(frames), 'stop');
      equal('usage forwarded', usageOf(frames)?.total_tokens, 7);

      mode.openai = '429';
      const failedOver = await ask(message('gpt-3.5-turbo', { stream: true }));
      const failedOverFrames = await readSSE(failedOver);
      equal('stream fails over before the first byte', failedOver.headers.get('x-vishrouter-provider'), 'deepseek');
      equal('failover stream text', textOf(failedOverFrames), 'Hello from DeepSeek');
      mode.openai = 'ok';

      // Every provider must be down for this to be a "cannot start" stream.
      mode.openai = '429';
      mode.deepseek = '429';
      mode.anthropic = '429';
      const allDown = await ask(message('gpt-4o-mini', { stream: true }));
      const allDownBody = await allDown.json();
      equal('a stream that cannot start returns JSON, not SSE', allDown.status, 429);
      equal('and is not event-stream', allDown.headers.get('content-type')?.includes('event-stream'), false);
      equal('with a proper error envelope', allDownBody.error.type, 'rate_limit_error');
      mode.openai = 'ok';
      mode.deepseek = 'ok';
      mode.anthropic = 'ok';

      mode.openai = 'die-mid-stream';
      const broken = await ask(message('gpt-4o-mini', { stream: true }));
      const brokenFrames = await readSSE(broken);
      const errorFrame = chunksOf(brokenFrames).find((c) => c.error);
      check('mid-stream failure delivers partial content first', textOf(brokenFrames) === 'Partial ', `got ${JSON.stringify(textOf(brokenFrames))}`);
      check('mid-stream failure is reported inside the stream', Boolean(errorFrame), 'no error frame seen');
      equal('mid-stream error code', errorFrame?.error?.code, 'upstream_stream_error');
      equal('stream still terminated cleanly', brokenFrames.at(-1), '[DONE]');
      mode.openai = 'ok';
    }
  } finally {
    if (gateway) {
      gateway.child.kill();
      await once(gateway.child, 'exit').catch(() => {});
    }
    await openai.close();
    await deepseek.close();
    await anthropic.close();
    fs.unlinkSync(configPath);
  }
}

// ============================================================== live suite

async function liveSuite() {
  console.log('\x1b[1mVishRouter live check — real providers from .env\x1b[0m');

  const gateway = await spawnGateway({ PORT: '0', HOST: '127.0.0.1' });

  try {
    const health = await (await fetch(`${gateway.base}/health`)).json();
    const available = health.providers.filter((provider) => provider.available);

    console.log(`\n  configured providers: ${health.providers.map((p) => `${p.name}${p.available ? '' : ' (no key)'}`).join(', ')}`);

    if (available.length === 0) {
      console.log('\n  No provider has an API key — nothing to test against.');
      console.log('  Add a key to .env (OPENAI_API_KEY / ANTHROPIC_API_KEY / DEEPSEEK_API_KEY) and re-run.\n');
      failures += 1;
      return;
    }

    for (const provider of available) {
      const started = Date.now();
      const response = await postJson(gateway.base, {
        model: provider.default_model,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        max_tokens: 16,
      });
      const elapsed = Date.now() - started;
      const body = await response.json().catch(() => null);

      check(
        `${provider.name}: ${provider.default_model} responds`,
        response.status === 200,
        `status ${response.status} — ${JSON.stringify(body?.error ?? body)?.slice(0, 200)}`
      );
      if (response.status === 200) {
        console.log(
          `        -> served by ${response.headers.get('x-vishrouter-provider')} in ${elapsed}ms: ` +
            `${JSON.stringify(body.choices?.[0]?.message?.content ?? '').slice(0, 80)}`
        );
      }
    }

    const first = available[0];
    const streamed = await postJson(gateway.base, {
      model: first.default_model,
      messages: [{ role: 'user', content: 'Count to three.' }],
      max_tokens: 32,
      stream: true,
    });
    const frames = await readSSE(streamed);
    check(`${first.name}: streaming works`, streamed.status === 200 && frames.at(-1) === '[DONE]', `status ${streamed.status}`);
    console.log(`        -> ${JSON.stringify(textOf(frames)).slice(0, 100)}`);
  } finally {
    gateway.child.kill();
    await once(gateway.child, 'exit').catch(() => {});
  }
}

// ==================================================================== main

try {
  if (LIVE) await liveSuite();
  else await offlineSuite();
} catch (error) {
  failures += 1;
  console.error(`\n\x1b[31mSmoke test crashed:\x1b[0m ${error.message}`);
}

const total = results.length;
console.log('\n' + '─'.repeat(60));
if (total > 0) {
  for (const result of results.filter((r) => !r.ok)) console.log(`  FAILED: ${result.name} — ${result.detail}`);
  console.log(`  ${total - failures}/${total} checks passed`);
}
console.log('─'.repeat(60));

if (failures > 0) {
  console.log('\x1b[31mSMOKE TEST FAILED\x1b[0m\n');
  process.exit(1);
}
console.log('\x1b[32mSMOKE TEST PASSED\x1b[0m\n');
process.exit(0);
