// Full-screen status message with a back link — the loading / error / empty
// state for a whole view.
export default function CenteredMessage({ title, detail, onBack }: { title: string; detail?: string; onBack: () => void }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 gap-4">
      <h1 className="text-2xl font-bold text-white">{title}</h1>
      {detail && <p className="text-gray-400 text-sm max-w-md text-center">{detail}</p>}
      <button
        onClick={onBack}
        className="px-6 py-2 border border-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors"
      >
        ← Home
      </button>
    </div>
  )
}
