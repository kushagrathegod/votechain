import { useState, useEffect, useCallback, useRef } from 'react'
import { config } from '../config'
import { getAuthHeaders } from '../auth'
import Web3 from 'web3'

function Candidates() {
  const [elections, setElections] = useState([])
  const [activeElection, setActiveElection] = useState('')
  const [candidates, setCandidates] = useState([])
  const [loading, setLoading] = useState(true)
  const [contract, setContract] = useState(null)
  const [account, setAccount] = useState(null)
  const [connectionStatus, setConnectionStatus] = useState('connecting')

  // Form state
  const [formData, setFormData] = useState({ name: '', party: '', logoFile: null })
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })

  // Edit modal state
  const [editModal, setEditModal] = useState({ open: false, id: null, name: '', party: '', logoFile: null })

  // CSV state
  const [csvFile, setCsvFile] = useState(null)
  const [csvUploading, setCsvUploading] = useState(false)
  const csvInputRef = useRef(null)

  const initBlockchain = useCallback(async (isRefresh = false) => {
    try {
      const resp = await fetch(`${config.backendUrl}/contract.json?t=${Date.now()}`)
      if (!resp.ok) return setConnectionStatus('error')
      const info = await resp.json()
      if (!window.ethereum) return setConnectionStatus('no-wallet')

      const w3 = new Web3(window.ethereum)
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      const c = new w3.eth.Contract(info.abi, info.address)

      setAccount(accounts[0])
      setContract(c)
      setConnectionStatus('connected')

      // Load elections
      const ids = await c.methods.getElectionIds().call()
      const electionData = []
      for (const id of [...ids].reverse()) {
        const details = await c.methods.getElection(id).call()
        electionData.push({ id, name: details[1] })
      }
      setElections(electionData)
      
      // Only auto-select if nothing is selected yet, or if we were refreshed manually
      if (electionData.length > 0 && (!activeElection || isRefresh)) {
        if (!activeElection || !electionData.find(e => e.id === activeElection)) {
           setActiveElection(electionData[0].id)
        }
      }
    } catch (err) {
      console.error('Init failed:', err)
      setConnectionStatus('error')
    }
  }, [activeElection]);

  // Initialize Web3
  useEffect(() => {
    initBlockchain()
  }, [])

  const uploadLogo = async (partyName, file) => {
    if (!file) return;
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const partySlug = partyName.toLowerCase().replace(/[^a-z0-9]/g, '');
          const res = await fetch(`${config.backendUrl}/api/party-logo`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ partySlug, imageBase64: reader.result })
          });
          if (!res.ok) throw new Error('Logo upload failed');
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const loadCandidates = useCallback(async () => {
    if (!contract) return
    if (!activeElection) {
      setLoading(false)
      setCandidates([])
      return
    }
    setLoading(true)
    try {
      const count = Number(await contract.methods.getCandidateCount(activeElection).call())
      const candidateList = []

      for (let i = 1; i <= count; i++) {
        const raw = await contract.methods.getCandidate(activeElection, i).call()
        const id = Number(raw[0])
        if (id === 0) continue // Skip deleted
        candidateList.push({
          id,
          name: raw[1],
          party: raw[2],
          votes: Number(raw[3])
        })
      }
      setCandidates(candidateList)
    } catch (err) {
      console.error('Failed to load candidates:', err)
    } finally {
      setLoading(false)
    }
  }, [contract, activeElection])

  useEffect(() => {
    loadCandidates()
  }, [loadCandidates])

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!contract || !account || !activeElection) return

    const { name, party } = formData
    if (!name.trim() || !party.trim()) {
      setMessage({ type: 'error', text: 'Name and party are required' })
      return
    }

    setSubmitting(true)
    setMessage({ type: '', text: '' })

    try {
      await contract.methods.addCandidate(activeElection, name.trim(), party.trim())
        .send({ from: account })
        .on('receipt', async () => {
          if (formData.logoFile) await uploadLogo(party, formData.logoFile).catch(console.error);
          setMessage({ type: 'success', text: 'Candidate added' })
          setFormData({ name: '', party: '', logoFile: null })
          loadCandidates()
        })
        .on('error', (err) => {
          setMessage({ type: 'error', text: err.message || 'Transaction failed' })
        })
    } catch (err) {
      if (err.message) setMessage({ type: 'error', text: err.message })
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = async () => {
    if (!editModal.id) return
    try {
      await contract.methods.updateCandidate(activeElection, editModal.id, editModal.name, editModal.party)
        .send({ from: account })
        .on('receipt', async () => {
          if (editModal.logoFile) await uploadLogo(editModal.party, editModal.logoFile).catch(console.error);
          setEditModal({ open: false, id: null, name: '', party: '', logoFile: null })
          loadCandidates()
        })
        .on('error', (err) => {
          alert(err.message || 'Transaction failed')
        })
    } catch (err) {
      if (err.message) alert(err.message)
    }
  }

  const handleDelete = async (id, name) => {
    if (!confirm(`Remove "${name}" from this election?`)) return
    try {
      await contract.methods.deleteCandidate(activeElection, id).send({ from: account })
        .on('receipt', () => {
          loadCandidates()
        })
        .on('error', (err) => {
          alert(err.message || 'Deletion failed')
        })
    } catch (err) {
      if (err.message) alert(err.message)
    }
  }

  const handleCsvUpload = async () => {
    if (!csvFile || !activeElection) return
    setCsvUploading(true)

    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const text = e.target.result
        const res = await fetch(`${config.backendUrl}/api/candidates/bulk-csv`, {
          method: 'POST',
          headers: {
            ...getAuthHeaders(),
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ csv: text, electionId: activeElection })
        })
        const data = await res.json()

        if (!res.ok) throw new Error(data.message || 'Upload failed')

        let msg = `Successfully imported ${data.imported || 0} candidates.`;
        if (data.skipped > 0) {
          msg += ` Skipped ${data.skipped} rows due to errors.`;
        }
        
        setCsvFile(null);
        if (csvInputRef.current) csvInputRef.current.value = '';
        
        // Always refresh to show what WAS imported
        loadCandidates();
        
        if (data.errors && data.errors.length > 0) {
          // Show first error and count of others
          const firstErr = data.errors[0];
          const others = data.errors.length - 1;
          const fullMsg = others > 0 ? `${msg} (e.g., ${firstErr} ...and ${others} more)` : `${msg} (${firstErr})`;
          setMessage({ type: data.imported > 0 ? 'success' : 'error', text: fullMsg });
        } else {
          setMessage({ type: 'success', text: msg });
        }
      } catch (err) {
        setMessage({ type: 'error', text: err.message })
      } finally {
        setCsvUploading(false)
      }
    }
    reader.onerror = () => {
      setMessage({ type: 'error', text: 'Failed to read file' })
      setCsvUploading(false)
    }
    reader.readAsText(csvFile)
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-surface-800">Candidates</h1>
          <p className="text-surface-500 mt-1">Manage election nominees</p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={activeElection}
            onChange={(e) => setActiveElection(e.target.value)}
            className="bg-surface-50 border border-surface-300 rounded-lg px-3 py-2 text-sm text-surface-700 focus:outline-none focus:border-primary-500"
          >
            {elections.length === 0 ? (
              <option value="">No elections</option>
            ) : (
              elections.map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))
            )}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Add Candidate Form */}
        <div className="premium-card p-6 h-fit">
          <h2 className="text-lg font-medium text-surface-800 mb-5">Add Candidate</h2>

          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-surface-600 mb-1.5">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))}
                placeholder="Full name"
                className="w-full bg-surface-50 border border-surface-300 rounded-lg px-3.5 py-2.5 text-surface-800 placeholder-surface-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-600 mb-1.5">Party</label>
              <input
                type="text"
                value={formData.party}
                onChange={(e) => setFormData(p => ({ ...p, party: e.target.value }))}
                placeholder="Political party"
                className="w-full bg-surface-50 border border-surface-300 rounded-lg px-3.5 py-2.5 text-surface-800 placeholder-surface-400 focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-200"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-surface-600 mb-1.5">Party Logo (Optional)</label>
              <input
                type="file"
                accept="image/png, image/jpeg"
                onChange={(e) => setFormData(p => ({ ...p, logoFile: e.target.files[0] }))}
                className="w-full bg-surface-50 border border-surface-300 rounded-lg px-3.5 py-2 text-sm text-surface-800 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
              />
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
              disabled={submitting || connectionStatus !== 'connected' || !activeElection}
              className="w-full bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-2.5 rounded-lg transition-colors"
            >
              {submitting ? 'Adding...' : 'Add Candidate'}
            </button>
          </form>

          {/* CSV Import */}
          <div className="mt-6 pt-6 border-t border-surface-200">
            <h3 className="text-sm font-medium text-surface-700 mb-3">Bulk Import</h3>
            <p className="text-xs text-surface-400 mb-3">CSV with columns: name, party</p>

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
                {csvFile ? csvFile.name : 'Click to select CSV'}
              </p>
            </div>

            {csvFile && (
              <button
                onClick={handleCsvUpload}
                disabled={csvUploading}
                className="w-full mt-3 bg-surface-100 hover:bg-surface-200 text-surface-700 font-medium py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {csvUploading ? 'Importing...' : 'Import Candidates'}
              </button>
            )}
          </div>
        </div>

        {/* Candidates List */}
        <div className="lg:col-span-2 premium-card p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-medium text-surface-800">
              Nominees {activeElection && <span className="text-primary-600">· {activeElection}</span>}
            </h2>
            <button
              onClick={() => {
                initBlockchain(true); // Full re-sync including contract address
                loadCandidates();
              }}
              className="text-sm text-surface-500 hover:text-primary-600 transition-colors flex items-center gap-1.5"
            >
              <span>🔄</span> Refresh
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : candidates.length === 0 ? (
            <div className="text-center py-12 text-surface-400">
              <p className="text-3xl mb-2">👤</p>
              <p>No candidates yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {candidates.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between p-4 bg-surface-50 rounded-lg border border-surface-200"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center text-lg font-medium">
                      {c.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-medium text-surface-800">{c.name}</h3>
                      <p className="text-sm text-surface-500">{c.party}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-lg font-semibold text-primary-600">{c.votes}</span>
                    <button
                      onClick={() => setEditModal({ open: true, id: c.id, name: c.name, party: c.party })}
                      className="p-2 text-surface-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(c.id, c.name)}
                      className="p-2 text-surface-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editModal.open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditModal({ open: false, id: null, name: '', party: '' })}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-medium text-surface-800 mb-4">Edit Candidate</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-surface-600 mb-1.5">Name</label>
                <input
                  type="text"
                  value={editModal.name}
                  onChange={(e) => setEditModal(p => ({ ...p, name: e.target.value }))}
                  className="w-full bg-surface-50 border border-surface-300 rounded-lg px-3.5 py-2.5 text-surface-800 focus:outline-none focus:border-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-600 mb-1.5">Party</label>
                <input
                  type="text"
                  value={editModal.party}
                  onChange={(e) => setEditModal(p => ({ ...p, party: e.target.value }))}
                  className="w-full bg-surface-50 border border-surface-300 rounded-lg px-3.5 py-2.5 text-surface-800 focus:outline-none focus:border-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-surface-600 mb-1.5">Update Logo (Optional)</label>
                <input
                  type="file"
                  accept="image/png, image/jpeg"
                  onChange={(e) => setEditModal(p => ({ ...p, logoFile: e.target.files[0] }))}
                  className="w-full bg-surface-50 border border-surface-300 rounded-lg px-3.5 py-2 text-sm text-surface-800 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleEdit}
                  className="flex-1 bg-primary-600 hover:bg-primary-700 text-white font-medium py-2.5 rounded-lg transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditModal({ open: false, id: null, name: '', party: '' })}
                  className="flex-1 bg-surface-100 hover:bg-surface-200 text-surface-700 font-medium py-2.5 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Candidates
