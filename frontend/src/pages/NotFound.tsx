import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'

/** Catch-all route. */
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-6 py-24 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-ios-blue-tint text-ios-blue">
        <Compass size={26} />
      </span>
      <h1 className="text-3xl font-bold tracking-tight text-ios-label">Page not found</h1>
      <p className="max-w-md text-sm text-ios-label-secondary">
        That route doesn&apos;t exist. It may have moved, or the link may be out of date.
      </p>
      <Link to="/" className="ios-btn-primary mt-3">
        Back to Model Library
      </Link>
    </div>
  )
}
