import { useState, useEffect, useCallback } from 'react'
import { getAuthHeaders } from '../auth'
import { config } from '../config'
import Web3 from 'web3'

function Elections() {
  const [elections, setElections] = useState([])
  const [loading, setLoading] = useState(true)
  const [contract, setContract] = useState(null)
  const [account, setAccount] = useState(null)
  const [web3, setWeb3] = useState(null)
  const [connectionStatus, setConnectionStatus] = useState('connecting')

  // Form state
  const [formData, setFormData] = useState({
    electionId: '',
    displayName: '',
    startDate: '',
    endDate: ''
  })
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })

  // Initialize Web3 and contract
  useEffect(() => {
    async function initBlockchain() {
      try {
        const resp = await fetch(`${config.backendUrl}/contract.json?t=${Date.now()}`)
        if (!resp.ok) {
          setConnectionStatus('error')
          return
        }
        const info = await resp.json()

        if (!window.ethereum) {
          setConnectionStatus('no-wallet')
          return
        }

        const w3 = new Web3(window.ethereum)
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
        const acc = accounts[0]
        const c = new w3.eth.Contract(info.abi, info.address)

        setWeb3(w3)
        setAccount(acc)
        setContract(c)
        setConnectionStatus('connected')
      } catch (err) {
        console.error('Blockchain init failed:', err)
        setConnectionStatus('error')
      }
    }
    initBlockchain()
  }, [])

  const loadElections = useCallback(async () => {
    if (!contract) return
    setLoading(true)
    try {
      const ids = await contract.methods.getElectionIds().call()
      const electionData = []

      for (const id of [...ids].reverse()) {
        const details = await contract.methods.getElection(id).call()
        electionData.push({
          id,
          name: details[1],
          startDate: new Date(Number(details[2]) * 1000),
          endDate: new Date(Number(details[3]) * 1000)
        })
      }
      setElections(electionData)
    } catch (err) {
      console.error('Failed to load elections:', err)
    } finally {
      setLoading(false)
    }
  }, [contract])

  useEffect(() => {
    if (contract) loadElections()
  }, [contract, loadElections])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!contract || !account) return

    const { electionId, displayName, startDate, endDate } = formData
    if (!electionId.trim() || !displayName.trim() || !startDate || !endDate) {
      setMessage({ type: 'error', text: 'All fields are required' })
      return
    }

    setSubmitting(true)
    setMessage({ type: '', text: '' })

    try {
      const start = Math.floor(new Date(startDate).getTime() / 1000)
      const end = Math.floor(new Date(endDate).getTime() / 1000)

      await contract.methods.createElection(electionId.trim(), displayName.trim(), start, end)
        .send({ from: account })
        .on('receipt', () => {
          setMessage({ type: 'success', text: 'Election created on blockchain' })
          setFormData({ electionId: '', displayName: '', startDate: '', endDate: '' })
          loadElections()
        })
        .on('error', (err) => {
          console.error(err)
          setMessage({ type: 'error', text: err.message || 'Transaction failed' })
        })

    } catch (err) {
      if (err.message) {
         setMessage({ type: 'error', text: err.message })
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm(`Remove "${id}" from blockchain? This cannot be undone.`)) return
    try {
      await contract.methods.deleteElection(id).send({ from: account })
        .on('receipt', () => {
          loadElections()
        })
        .on('error', (err) => {
          alert(err.message || 'Deletion failed')
        })
    } catch (err) {
      if (err.message) alert(err.message)
    }
  }

  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const isElectionActive = (start, end) => {
    const now = new Date()
    return now >= start && now <= end
  }

  return (
    <div className="space-y-8">
      {/* Connection Status */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-surface-800">Election Sessions</h1>
          <p className="text-surface-500 mt-1">Create and manage voting sessions on blockchain</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-surface-100 rounded-lg">
          <span className={`w-2 h-2 rounded-full ${
            connectionStatus === 'connected' ? 'bg-green-500' :
            connectionStatus === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-red-500'
          }`} />
          <span className="text-sm text-surface-600">
            {connectionStatus === 'connected' && account ?
              `${account.slice(0, 6)}...${account.slice(-4)}` :
              connectionStatus === 'connecting' ? 'Connecting...' :
              connectionStatus === 'no-wallet' ? 'Install MetaMask' : 'Connection Error'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Create Election Form */}
        <div className="lg:col-span-2 premium-card p-6 h-fit">
          <h2 className="text-lg font-medium text-surface-800 mb-5">Create Session</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-surface-600 mb-1.5">
                Election ID
              </label>
              <input
                type="text"
                value={formData.electionId}
                onChange={(e) => setFormData(p => ({ ...p, electionId: e.target.value }))}
                placeholder="e.g. council-2026"
                className="w-full bg-surface-50 border border-surface-300 rounded-lg px-3.5 py-2.5 text-surface-800 placeholder-surface-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200"
              />
              <p className="text-xs text-surface-400 mt-1">Unique identifier (no spaces)</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-600 mb-1.5">
                Display Name
              </label>
              <input
                type="text"
                value={formData.displayName}
                onChange={(e) => setFormData(p => ({ ...p, displayName: e.target.value }))}
                placeholder="e.g. Student Council Elections"
                className="w-full bg-surface-50 border border-surface-300 rounded-lg px-3.5 py-2.5 text-surface-800 placeholder-surface-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-surface-600 mb-1.5">Start</label>
                <input
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData(p => ({ ...p, startDate: e.target.value }))}
                  className="w-full bg-surface-50 border border-surface-300 rounded-lg px-3 py-2.5 text-surface-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-600 mb-1.5">End</label>
                <input
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData(p => ({ ...p, endDate: e.target.value }))}
                  className="w-full bg-surface-50 border border-surface-300 rounded-lg px-3 py-2.5 text-surface-800 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200"
                />
              </div>
            </div>

            {message.text && (
              <div className={`text-sm px-3 py-2 rounded-lg ${
                message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
                'bg-red-50 text-red-700 border border-red-200'
              }`}>
                {message.text}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || connectionStatus !== 'connected'}
              className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors"
            >
              {submitting ? 'Deploying...' : 'Deploy to Blockchain'}
            </button>
          </form>
        </div>

        {/* Elections List */}
        <div className="lg:col-span-3 premium-card p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-surface-800">Active Sessions</h2>
            <button
              onClick={loadElections}
              className="text-sm text-surface-500 hover:text-primary-600 transition-colors"
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : elections.length === 0 ? (
            <div className="text-center py-12 text-surface-400">
              <p className="text-4xl mb-3">🗳️</p>
              <p>No election sessions found</p>
              <p className="text-sm mt-1">Create one to get started</p>
            </div>
          ) : (
            <div className="space-y-3">
              {elections.map((election) => {
                const active = isElectionActive(election.startDate, election.endDate)
                return (
                  <div
                    key={election.id}
                    className="flex items-center justify-between p-4 bg-surface-50 rounded-lg border border-surface-200 hover:border-surface-300 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-surface-800 truncate">{election.name}</h3>
                        {active && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">
                            Live
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-surface-500 mt-0.5">
                        {election.id} · {formatDate(election.startDate)} – {formatDate(election.endDate)}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDelete(election.id)}
                      className="ml-4 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Elections
