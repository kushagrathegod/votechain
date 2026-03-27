import { useState } from 'react'
import { config } from '../config'

function Receipt() {
  const [txHash, setTxHash] = useState('')
  const [receipt, setReceipt] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const fetchReceipt = async () => {
    if (!txHash.trim()) {
      setError('Please enter a transaction hash')
      return
    }

    setLoading(true)
    setError('')
    setReceipt(null)

    try {
      const response = await fetch(`${config.backendUrl}/api/receipt/${txHash}`)
      if (response.ok) {
        const data = await response.json()
        setReceipt(data)
      } else {
        setError('Transaction not found')
      }
    } catch (err) {
      setError('Error fetching receipt')
      console.warn('Receipt fetch failed:', err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') fetchReceipt()
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-surface-800 animate-fadeIn">Transaction Receipt</h1>

      {/* Search Box */}
      <div className="premium-card p-6 animate-fadeIn delay-100">
        <label className="block text-sm font-medium text-surface-700 mb-3">
          Transaction Hash (0x...)
        </label>
        <div className="flex gap-3">
          <input
            type="text"
            value={txHash}
            onChange={(e) => setTxHash(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="0x..."
            className="flex-1 bg-surface-50 border border-surface-300 rounded-xl px-4 py-3 text-surface-800 placeholder-surface-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 transition-all"
          />
          <button
            onClick={fetchReceipt}
            disabled={loading}
            className="bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-xl font-medium transition-all btn-press shadow-sm hover:shadow-md focus-ring"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Searching...
              </span>
            ) : 'Search'}
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 animate-fadeIn">
          <p className="text-red-600 flex items-center gap-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            {error}
          </p>
        </div>
      )}

      {/* Receipt Display */}
      {receipt && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fadeIn">
          {/* Transaction Confirmed */}
          <div className="bg-green-50 border-2 border-green-200 rounded-xl p-6 card-hover">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              </span>
              <p className="text-green-700 font-semibold">Transaction Confirmed</p>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-green-600 text-xs font-medium uppercase tracking-wide">Hash</p>
                <p className="text-surface-800 font-mono text-sm break-all mt-1 bg-green-100/50 p-2 rounded-lg">{receipt.tx_hash}</p>
              </div>
              <div>
                <p className="text-green-600 text-xs font-medium uppercase tracking-wide">Block Number</p>
                <p className="text-surface-800 font-semibold text-lg mt-1">{receipt.block_number}</p>
              </div>
            </div>
          </div>

          {/* Election Details */}
          <div className="bg-primary-50 border-2 border-primary-200 rounded-xl p-6 card-hover">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                <span className="text-lg">🗳️</span>
              </span>
              <p className="text-primary-700 font-semibold">Election Details</p>
            </div>
            <div className="space-y-4">
              <div>
                <p className="text-primary-600 text-xs font-medium uppercase tracking-wide">Election ID</p>
                <p className="text-surface-800 font-semibold text-lg mt-1">{receipt.election_id}</p>
              </div>
              <div>
                <p className="text-primary-600 text-xs font-medium uppercase tracking-wide">Timestamp</p>
                <p className="text-surface-800 mt-1">{new Date(receipt.timestamp * 1000).toLocaleString()}</p>
              </div>
            </div>
          </div>

          {/* Voter Hash */}
          <div className="bg-purple-50 border-2 border-purple-200 rounded-xl p-6 md:col-span-2 card-hover">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                </svg>
              </span>
              <p className="text-purple-700 font-semibold">Voter Hash (Anonymous)</p>
            </div>
            <p className="text-surface-800 font-mono text-sm break-all bg-purple-100/50 p-3 rounded-lg">{receipt.voter_hash}</p>
            <p className="text-purple-500 text-xs mt-3">Your identity is protected by cryptographic hashing</p>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!receipt && !error && !loading && (
        <div className="text-center py-12 animate-fadeIn">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-surface-100 rounded-2xl mb-4">
            <svg className="w-8 h-8 text-surface-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-surface-700 mb-2">Verify Your Vote</h3>
          <p className="text-surface-500 max-w-md mx-auto">
            Enter your transaction hash above to view your blockchain receipt and verify your vote was recorded correctly.
          </p>
        </div>
      )}
    </div>
  )
}

export default Receipt
