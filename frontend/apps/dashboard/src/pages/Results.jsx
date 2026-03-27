import { useState, useEffect } from 'react'
import { config } from '../config'
import Web3 from 'web3'

function Results() {
  const [elections, setElections] = useState([])
  const [activeElection, setActiveElection] = useState('')
  const [electionInfo, setElectionInfo] = useState(null)
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [contract, setContract] = useState(null)

  // Initialize Web3 (read-only)
  useEffect(() => {
    async function init() {
      try {
        const resp = await fetch(`${config.backendUrl}/contract.json`)
        if (!resp.ok) return
        const info = await resp.json()

        const w3 = new Web3(new Web3.providers.HttpProvider('http://127.0.0.1:8545'))
        const c = new w3.eth.Contract(info.abi, info.address)
        setContract(c)

        // Load elections
        const ids = await c.methods.getElectionIds().call()
        const electionData = []
        for (const id of [...ids].reverse()) {
          const details = await c.methods.getElection(id).call()
          electionData.push({ id, name: details[1] })
        }
        setElections(electionData)
        if (electionData.length > 0) setActiveElection(electionData[0].id)
      } catch (err) {
        console.error('Init failed:', err)
      }
    }
    init()
  }, [])

  useEffect(() => {
    async function loadResults() {
      if (!contract || !activeElection) return
      setLoading(true)

      try {
        const details = await contract.methods.getElection(activeElection).call()
        setElectionInfo({
          name: details[1],
          startDate: new Date(Number(details[2]) * 1000),
          endDate: new Date(Number(details[3]) * 1000)
        })

        const count = Number(await contract.methods.getCandidateCount(activeElection).call())
        const candidateList = []
        let totalVotes = 0

        for (let i = 1; i <= count; i++) {
          const raw = await contract.methods.getCandidate(activeElection, i).call()
          const id = Number(raw[0])
          if (id === 0) continue
          const votes = Number(raw[3])
          totalVotes += votes
          candidateList.push({
            id,
            name: raw[1],
            party: raw[2],
            votes
          })
        }

        // Sort by votes descending
        candidateList.sort((a, b) => b.votes - a.votes)

        // Add percentage
        setCandidates(candidateList.map(c => ({
          ...c,
          percentage: totalVotes > 0 ? Math.round((c.votes / totalVotes) * 100) : 0
        })))
      } catch (err) {
        console.error('Failed to load results:', err)
      } finally {
        setLoading(false)
      }
    }
    loadResults()

    // Refresh every 10 seconds
    const interval = setInterval(loadResults, 10000)
    return () => clearInterval(interval)
  }, [contract, activeElection])

  const totalVotes = candidates.reduce((sum, c) => sum + c.votes, 0)
  const leader = candidates[0]

  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const downloadResults = () => {
    if (!candidates.length || !electionInfo) return
    const rows = [
      ['Rank', 'Name', 'Party', 'Votes', 'Percentage'],
      ...candidates.map((c, idx) => [
        idx + 1, c.name, c.party, c.votes, `${c.percentage}%`
      ])
    ]
    const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([`Election: ${electionInfo.name}\nDate: ${formatDate(electionInfo.startDate)} - ${formatDate(electionInfo.endDate)}\nTotal Votes: ${totalVotes}\n\n${csv}`], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeElection}_results.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Colors for the bars
  const barColors = [
    'bg-primary-500',
    'bg-green-500',
    'bg-amber-500',
    'bg-red-500',
    'bg-purple-500',
    'bg-pink-500',
    'bg-cyan-500',
    'bg-orange-500'
  ]

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-surface-800">Live Results</h1>
          <p className="text-surface-500 mt-1">Real-time vote counts from blockchain</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={activeElection}
            onChange={(e) => setActiveElection(e.target.value)}
            className="bg-surface-50 border border-surface-300 rounded-lg px-4 py-2 text-sm text-surface-700 focus:outline-none focus:border-primary-500"
          >
            {elections.length === 0 ? (
              <option value="">No elections</option>
            ) : (
              elections.map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))
            )}
          </select>

          <button
            onClick={downloadResults}
            disabled={!candidates.length}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-white border border-surface-300 hover:border-primary-400 hover:bg-primary-50 text-surface-700 hover:text-primary-700 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download CSV
          </button>
        </div>
      </div>

      {/* Election Info */}
      {electionInfo && (
        <div className="bg-gradient-to-r from-primary-50 to-primary-100/50 border border-primary-200 rounded-xl p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h2 className="text-xl font-semibold text-surface-800">{electionInfo.name}</h2>
              <p className="text-surface-600 mt-1">
                {formatDate(electionInfo.startDate)} – {formatDate(electionInfo.endDate)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-primary-600">{totalVotes}</p>
              <p className="text-sm text-surface-500">Total Votes</p>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : candidates.length === 0 ? (
        <div className="bg-white border border-surface-200 rounded-xl p-12 text-center">
          <p className="text-4xl mb-3">📊</p>
          <p className="text-surface-500">No candidates or votes yet</p>
        </div>
      ) : (
        <>
          {/* Leader Card */}
          {leader && leader.votes > 0 && (
            <div className="bg-white border-2 border-green-200 rounded-xl p-6 shadow-card">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-green-100 text-green-600 rounded-full flex items-center justify-center text-2xl font-bold">
                  1
                </div>
                <div className="flex-1">
                  <p className="text-sm text-green-600 font-medium">Leading</p>
                  <h3 className="text-xl font-semibold text-surface-800">{leader.name}</h3>
                  <p className="text-surface-500">{leader.party}</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold text-green-600">{leader.percentage}%</p>
                  <p className="text-sm text-surface-500">{leader.votes} votes</p>
                </div>
              </div>
            </div>
          )}

          {/* Results Chart */}
          <div className="premium-card p-6">
            <h2 className="text-lg font-medium text-surface-800 mb-6">Vote Distribution</h2>

            <div className="space-y-5">
              {candidates.map((c, idx) => (
                <div key={c.id}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-surface-500 w-6">{idx + 1}</span>
                      <div>
                        <p className="font-medium text-surface-800">{c.name}</p>
                        <p className="text-sm text-surface-500">{c.party}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-surface-800">{c.votes}</p>
                      <p className="text-sm text-surface-500">{c.percentage}%</p>
                    </div>
                  </div>

                  <div className="h-3 bg-surface-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${barColors[idx % barColors.length]} transition-all duration-500`}
                      style={{ width: `${c.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Auto-refresh indicator */}
          <div className="text-center text-sm text-surface-400">
            <p>Results refresh automatically every 10 seconds</p>
            <p className="mt-1">Data sourced directly from Ethereum blockchain</p>
          </div>
        </>
      )}
    </div>
  )
}

export default Results
