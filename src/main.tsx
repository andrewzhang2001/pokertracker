import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider, SignedIn, SignedOut, SignIn } from '@clerk/clerk-react'
import './index.css'
import App from './App'

// Vercel's Clerk integration provisions NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
// VITE_CLERK_PUBLISHABLE_KEY is accepted as a local-dev fallback.
const publishableKey = (import.meta.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  ?? import.meta.env.VITE_CLERK_PUBLISHABLE_KEY) as string | undefined

function Root() {
  if (!publishableKey) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center p-6">
        <div>
          <p className="text-lg font-semibold text-white mb-2">Auth not configured</p>
          <p className="text-sm text-gray-500">Set <code className="text-gray-300">VITE_CLERK_PUBLISHABLE_KEY</code> in your environment.</p>
        </div>
      </div>
    )
  }
  return (
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
      <SignedIn><App /></SignedIn>
      <SignedOut>
        <div className="min-h-screen flex flex-col items-center justify-center gap-6 p-8">
          <h1 className="text-3xl font-bold text-white">Poker Hand Tracker</h1>
          <SignIn routing="hash" />
        </div>
      </SignedOut>
    </ClerkProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
