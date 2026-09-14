import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Lock, Mail, RotateCw, X } from 'lucide-react'

import { MOCK_USER_NAME } from '../lib/auth'

/**
 * iOS-style sign-in sheet.
 *
 * Mounted only while open (the parent renders it conditionally), so the form
 * state resets naturally between openings and no setState-in-effect is needed.
 *
 * Validation is intentionally shallow — non-empty fields only — because this is
 * a mock: nothing is sent anywhere and no credentials are checked.
 */
export default function LoginModal({
  onClose,
  onLogin,
}: {
  onClose: () => void
  onLogin: (name: string) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Lock background scrolling while the sheet is up, and restore on unmount.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    emailRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()

    const nextErrors: { email?: string; password?: string } = {}
    if (!email.trim()) nextErrors.email = 'Email is required.'
    if (!password.trim()) nextErrors.password = 'Password is required.'

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    onLogin(MOCK_USER_NAME)
  }

  const clearError = (field: 'email' | 'password') =>
    setErrors((previous) => ({ ...previous, [field]: undefined }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-ios-label/30 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="login-title"
        className="relative w-full max-w-sm rounded-ios-xl border border-ios-separator bg-ios-surface p-6 shadow-ios-lg"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-ios-fill text-ios-label-secondary transition-colors hover:text-ios-label"
        >
          <X size={15} />
        </button>

        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ios-blue text-white shadow-ios-sm">
            <RotateCw size={22} strokeWidth={2.6} />
          </span>
          <h2 id="login-title" className="text-lg font-bold tracking-tight text-ios-label">
            Log in to VishRouter
          </h2>
          <p className="text-sm text-ios-label-secondary">
            Any email and password will work — this is a mock sign-in.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <label htmlFor="login-email" className="mb-1.5 block text-[13px] font-medium text-ios-label">
              Email
            </label>
            <div className="relative">
              <Mail
                size={15}
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ios-label-tertiary"
              />
              <input
                ref={emailRef}
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  clearError('email')
                }}
                placeholder="you@example.com"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'login-email-error' : undefined}
                className={`ios-input pl-10 ${errors.email ? 'border-ios-red focus:border-ios-red' : ''}`}
              />
            </div>
            {errors.email && (
              <p id="login-email-error" className="mt-1.5 text-xs text-ios-red">
                {errors.email}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="mb-1.5 block text-[13px] font-medium text-ios-label"
            >
              Password
            </label>
            <div className="relative">
              <Lock
                size={15}
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-ios-label-tertiary"
              />
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  clearError('password')
                }}
                placeholder="••••••••"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'login-password-error' : undefined}
                className={`ios-input pl-10 ${errors.password ? 'border-ios-red focus:border-ios-red' : ''}`}
              />
            </div>
            {errors.password && (
              <p id="login-password-error" className="mt-1.5 text-xs text-ios-red">
                {errors.password}
              </p>
            )}
          </div>

          <button type="submit" className="ios-btn-primary w-full">
            Log In
          </button>
        </form>
      </div>
    </div>
  )
}
