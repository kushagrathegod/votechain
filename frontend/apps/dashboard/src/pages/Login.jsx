import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { saveToken } from '../auth'
import { config } from '../config'

function Login() {
  const [voterId, setVoterId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!voterId.trim() || !password.trim()) {
      setError('Please enter your Voter ID and password')
      return
    }
    setLoading(true)
    setError('')

    try {
      const res = await fetch(`${config.backendUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voter_id: voterId.trim(), password }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Invalid credentials')
        return
      }

      saveToken(data.token)
      navigate('/')
    } catch (err) {
      console.error('Login failed:', err.message)
      setError('Cannot reach the server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-primary-100 rounded-xl mb-4">
            <span className="text-2xl">🗳️</span>
          </div>
          <h1 className="text-2xl font-semibold text-surface-800">VoteChain</h1>
          <p className="text-surface-500 mt-1">Decentralized Voting Platform</p>
        </div>

        {/* Card */}
        <div className="premium-card p-6">
          <h2 className="text-lg font-medium text-surface-800 mb-5">Sign in</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-surface-600 mb-1.5">
                Voter ID
              </label>
              <input
                type="text"
                value={voterId}
                onChange={(e) => setVoterId(e.target.value)}
                placeholder="Enter your voter ID"
                autoFocus
                autoComplete="username"
                className="w-full bg-surface-50 border border-surface-300 rounded-lg px-3.5 py-2.5 text-surface-800 placeholder-surface-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200 transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-600 mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                className="w-full bg-surface-50 border border-surface-300 rounded-lg px-3.5 py-2.5 text-surface-800 placeholder-surface-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200 transition-colors"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </span>
              ) : 'Sign in'}
            </button>
          </form>

          <div className="mt-5 pt-5 border-t border-surface-200">
            <p className="text-xs text-surface-400 text-center">
              Contact your administrator for credentials
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-surface-400 text-sm mt-6">
          Secured by Ethereum blockchain
        </p>
      </div>
    </div>
  )
}

export default Login
