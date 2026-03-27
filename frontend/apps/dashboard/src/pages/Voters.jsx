import { useState, useEffect, useRef } from 'react'
import { getAuthHeaders } from '../auth'
import { config } from '../config'

function Voters() {
  const [voters, setVoters] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')

  // CSV state
  const [csvFile, setCsvFile] = useState(null)
  const [csvUploading, setCsvUploading] = useState(false)
  const [csvMessage, setCsvMessage] = useState({ type: '', text: '' })
  const csvInputRef = useRef(null)

  const loadVoters = async () => {
    setLoading(true)
    try {
      const res = await fetch(`${config.backendUrl}/api/voters`, {
        headers: getAuthHeaders()
      })
      if (res.ok) {
        const data = await res.json()
        setVoters(data.filter(v => v.role !== 'admin'))
      }
    } catch (err) {
      console.error('Failed to load voters:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadVoters()
  }, [])

  const handleApprove = async (voterId) => {
    try {
      const res = await fetch(`${config.backendUrl}/api/voters/${voterId}/approve`, {
        method: 'PUT',
        headers: getAuthHeaders()
      })
      if (res.ok) loadVoters()
    } catch (err) {
      console.error('Approve failed:', err)
    }
  }

  const handleDelete = async (voterId, name) => {
    if (!confirm(`Remove ${name || voterId} from the system?`)) return
    try {
      const res = await fetch(`${config.backendUrl}/api/voters/${voterId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      })
      if (res.ok) loadVoters()
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  const handleCsvUpload = async () => {
    if (!csvFile) return
    setCsvUploading(true)
    setCsvMessage({ type: '', text: '' })

    const formData = new FormData()
    formData.append('file', csvFile)

    try {
      const res = await fetch(`${config.backendUrl}/api/voters/bulk-csv`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: formData
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Upload failed')

      setCsvMessage({ type: 'success', text: `Imported ${data.imported || 0} voters` })
      setCsvFile(null)
      if (csvInputRef.current) csvInputRef.current.value = ''
      loadVoters()
    } catch (err) {
      setCsvMessage({ type: 'error', text: err.message })
    } finally {
      setCsvUploading(false)
    }
  }

  const filteredVoters = voters.filter(v => {
    const matchesFilter = filter === 'all' || v.status === filter
    const matchesSearch = !searchTerm ||
      v.voter_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      v.full_name?.toLowerCase().includes(searchTerm.toLowerCase())
    return matchesFilter && matchesSearch
  })

  const pendingCount = voters.filter(v => v.status === 'pending').length
  const approvedCount = voters.filter(v => v.status === 'approved').length

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-surface-800">Voters</h1>
        <p className="text-surface-500 mt-1">Manage voter registrations and access</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="premium-card p-6">
          <p className="text-sm text-surface-500">Total Voters</p>
          <p className="text-3xl font-semibold text-surface-800 mt-1">{voters.length}</p>
        </div>
        <div className="premium-card p-6">
          <p className="text-sm text-surface-500">Approved</p>
          <p className="text-3xl font-semibold text-green-600 mt-1">{approvedCount}</p>
        </div>
        <div className="premium-card p-6">
          <p className="text-sm text-surface-500">Pending</p>
          <p className="text-3xl font-semibold text-amber-600 mt-1">{pendingCount}</p>
        </div>
      </div>

      {/* CSV Import */}
      <div className="premium-card p-6">
        <h2 className="text-lg font-medium text-surface-800 mb-4">Bulk Import</h2>
        <p className="text-sm text-surface-500 mb-4">
          Required columns: <code className="bg-surface-100 px-1.5 py-0.5 rounded text-primary-600">voter_id, full_name, password</code>
          <br />
          Optional: <code className="bg-surface-100 px-1.5 py-0.5 rounded text-surface-600">email, booth_id</code>
        </p>

        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <div
              onClick={() => csvInputRef.current?.click()}
              className="border-2 border-dashed border-surface-300 rounded-lg p-4 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50/30 transition-colors"
            >
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv"
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                className="hidden"
              />
              <p className="text-sm text-surface-500">
                {csvFile ? csvFile.name : 'Click to select CSV file'}
              </p>
            </div>
          </div>

          <button
            onClick={handleCsvUpload}
            disabled={!csvFile || csvUploading}
            className="px-6 py-3 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors"
          >
            {csvUploading ? 'Importing...' : 'Import'}
          </button>
        </div>

        {csvMessage.text && (
          <div className={`mt-4 text-sm px-3 py-2 rounded-lg ${csvMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' :
              'bg-red-50 text-red-700 border border-red-200'
            }`}>
            {csvMessage.text}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="premium-card p-6">
        <div className="flex flex-wrap gap-4 items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            {['all', 'approved', 'pending'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${filter === f
                    ? 'bg-primary-600 text-white'
                    : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
                  }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-surface-50 border border-surface-300 rounded-lg px-3 py-2 text-sm text-surface-800 placeholder-surface-400 focus:outline-none focus:border-primary-500 w-48"
            />
            <button
              onClick={loadVoters}
              className="p-2 text-surface-500 hover:text-primary-600 hover:bg-surface-100 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredVoters.length === 0 ? (
          <div className="text-center py-12 text-surface-400">
            <p className="text-3xl mb-2">👥</p>
            <p>No voters found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredVoters.map((v) => (
              <div
                key={v.voter_id}
                className="flex items-center justify-between p-4 bg-surface-50 rounded-lg border border-surface-200"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-surface-200 rounded-full flex items-center justify-center text-surface-600 font-medium">
                    {(v.full_name || v.voter_id).charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-surface-800">{v.full_name || 'Anonymous'}</h3>
                      <span className={`px-2 py-0.5 text-xs font-medium rounded ${v.status === 'approved'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-amber-100 text-amber-700'
                        }`}>
                        {v.status}
                      </span>
                    </div>
                    <p className="text-sm text-surface-500">
                      {v.voter_id} {v.booth_id && `· ${v.booth_id}`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {v.status === 'pending' && (
                    <button
                      onClick={() => handleApprove(v.voter_id)}
                      className="px-3 py-1.5 text-sm font-medium text-green-700 hover:bg-green-50 rounded-lg transition-colors"
                    >
                      Approve
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(v.voter_id, v.full_name)}
                    className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default Voters
