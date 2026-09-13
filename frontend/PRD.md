# PRD: VishRouter Frontend Dashboard (iOS Style)

## 1. Overview

Build a modern, light-themed React dashboard for the VishRouter AI Gateway. The design language must
be heavily inspired by Apple's iOS Human Interface Guidelines: clean, minimalist, white backgrounds,
iOS blue accents (`#007AFF`), rounded corners (`rounded-xl`, `rounded-2xl`), and soft drop shadows. It
must connect to the local backend running on `http://127.0.0.1:3000`.

## 2. Tech Stack

- **Framework:** React + Vite + TypeScript
- **Styling:** Tailwind CSS (Light mode by default)
- **Routing:** React Router DOM
- **Icons:** Lucide React (for clean, iOS-like icons)
- **HTTP Client:** Native `fetch`

## 3. Design System (iOS Inspired)

- **Background:** Pure white (`bg-white`) for main areas, very light gray (`bg-gray-50` or `#F2F2F7`)
  for the app background.
- **Primary Color:** iOS Blue (`#007AFF` or `bg-blue-500`).
- **Text Colors:** Dark gray/black (`text-gray-900`) for headings, light gray (`text-gray-500`) for
  subtitles.
- **Borders:** Very subtle (`border-gray-200`).
- **Shadows:** Soft, diffused shadows (`shadow-sm`, `shadow-md`).
- **Corners:** Heavily rounded (`rounded-xl`, `rounded-2xl`, `rounded-full`).

## 4. Layout & Pages

### 4.1 Navbar

- Background: White with a subtle bottom border (`border-b border-gray-200`).
- Logo: "VishRouter" with an iOS Blue circular arrow icon.
- Links: MODELS, RANKINGS, PRICING, CHAT, DOCS. (Active link should have a blue underline or pill
  background.)
- Right Side: "LOG IN" button (blue pill shape), notification bell.

### 4.2 Model Library Page (`/`)

- **Left Sidebar (Filters):**
  - White background, rounded corners.
  - Checkboxes styled like iOS toggles or rounded squares.
  - "Reset" button in iOS blue.
- **Main Content:**
  - Title: "Model Library" (bold, large).
  - Search bar: `rounded-full` with a light gray background (`bg-gray-100`), similar to iOS Spotlight
    search.
  - Tabs: Segmented control style (like iOS `UISegmentedControl`) with a sliding blue background for
    the active tab.
  - **Data Table:** Clean white rows with subtle hover effects. Columns for Model Name, Provider,
    Input Price, Output Price, Context Length.
  - *Note:* Fetch from `GET http://127.0.0.1:3000/v1/models`. Display the 9 available models. Use
    placeholder data for missing fields (Uptime, Weekly Tokens) to match the layout.

### 4.3 Chat Page (`/chat`)

- **Model Selector:** A rounded dropdown at the top right.
- **Chat Window (iMessage Style):**
  - User messages on the right: Blue bubble (`bg-blue-500`), white text, `rounded-3xl` (with one
    corner slightly less rounded, like iMessage).
  - AI messages on the left: Light gray bubble (`bg-gray-200`), black text, `rounded-3xl`.
- **Input Area:**
  - A rounded text input (`rounded-full`) with a blue "Send" arrow button inside.
  - A toggle switch for "Streaming" (iOS style switch).
- **Metadata Badge:** After an AI responds, show a small, subtle badge above the message:
  `Provider: DeepSeek | Model: deepseek-chat | Fallback: No`.
- **API Connection:**
  - Send POST requests to `http://127.0.0.1:3000/v1/chat/completions`.
  - Handle both streaming and non-streaming responses.

## 5. Backend Requirement (CORS)

Ensure the backend `src/index.js` has the `cors` package installed and enabled so the frontend
(running on port 5173) can communicate with the backend (port 3000).

**Implementation note (already satisfied):** the gateway exposes CORS for
`http://localhost:5173` and `http://127.0.0.1:5173`, configurable via the `CORS_ORIGIN` environment
variable. The routing metadata the Chat page's badge depends on is published as the response headers
`x-vishrouter-provider`, `x-vishrouter-upstream-model`, `x-vishrouter-model-resolved-via`,
`x-vishrouter-fallback-used`, and `x-vishrouter-attempts` — these are listed in the CORS
`exposedHeaders` allow-list, because without that the browser would hide them from frontend JavaScript.

## 6. Implementation Steps

1. Scaffold Vite + React + TS project.
2. Install Tailwind CSS and configure the white/blue iOS theme.
3. Build the Navbar and Layout.
4. Build the Model Library page with iOS-style filters and data fetching.
5. Build the Chat page with iMessage-style bubbles and streaming support.
6. Test the connection to the local backend.
