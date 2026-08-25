import { UserButton } from '@clerk/clerk-react'

// The home screen: one card per surface the app can navigate to.
export default function LandingView({ onNavigate, onImport }: {
  onNavigate: (to: string) => void
  onImport: () => void
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 gap-8">
      <div className="absolute top-3 right-3"><UserButton afterSignOutUrl="/" /></div>
      <h1 className="text-4xl font-bold text-white">Poker Hand Tracker</h1>
      {(() => {
        const Card = ({ to, icon, title, desc, onClick }: { to?: string; icon: string; title: string; desc: string; onClick?: () => void }) => (
          <button
            onClick={onClick ?? (() => onNavigate(to!))}
            className="w-64 h-44 rounded-xl border border-gray-700 bg-gray-900 hover:border-yellow-500 hover:bg-gray-800 transition-colors flex flex-col items-center justify-center gap-3 text-center px-6"
          >
            <span className="text-3xl">{icon}</span>
            <span className="text-lg font-semibold text-white">{title}</span>
            <span className="text-xs text-gray-500">{desc}</span>
          </button>
        )
        return (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col sm:flex-row gap-6">
              <Card icon="📥" title="Import" desc="Paste a hand history to review, then export to your database" onClick={onImport} />
              <Card to="/database" icon="🗄️" title="View Database" desc="Browse and filter your saved hands" />
              <Card to="/graph" icon="📈" title="Graph" desc="BB won/lost, winrate, all-in adjusted &amp; rake" />
            </div>
            <div className="flex flex-col sm:flex-row gap-6">
              <Card to="/reports" icon="📊" title="Reports" desc="Population tendencies — RFI by position, and more" />
              <Card to="/leakbuster" icon="🛠️" title="Leakbuster" desc="Your own EV leaks vs GTO — same reports, your hands" />
              <Card to="/postflop" icon="🃏" title="Postflop" desc="Spot browser — formations, lines &amp; sizing" />
            </div>
            <div className="flex flex-col sm:flex-row gap-6">
              <Card to="/profiles" icon="👤" title="PokerNow Profiles" desc="Your private roster — data on the people you play" />
              <Card to="/solver-compare" icon="🎯" title="Range vs Solver" desc="POC — your HU SB RFI frequency vs GTO" />
            </div>
          </div>
        )
      })()}
    </div>
  )
}
