import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { config } from '../config'
import { getAuthHeaders } from '../auth'

const BOOTHS = [
  { id: 'BOOTH_001', label: 'Booth 1 — North Zone' },
  { id: 'BOOTH_002', label: 'Booth 2 — South Zone' },
  { id: 'BOOTH_003', label: 'Booth 3 — East Zone' },
  { id: 'BOOTH_004', label: 'Booth 4 — West Zone' },
  { id: 'BOOTH_005', label: 'Booth 5 — Central Zone' },
  { id: 'BOOTH_006', label: 'Booth 6 — Outer Zone' },
]
const HOURS = Array.from({ length: 12 }, (_, i) => `${6 + i}:00`)

function BoothManagement() {
  const [selectedBooth, setSelectedBooth] = useState('BOOTH_001')
  const [forecastData, setForecastData] = useState([])
  const [forecastLoading, setForecastLoading] = useState(false)
  const [peakInfo, setPeakInfo] = useState(null)
  const [boothStats, setBoothStats] = useState([])
  const [statsLoading, setStatsLoading] = useState(true)

  // Fetch live voter-per-booth stats from DB
  useEffect(() => {
    const fetchStats = async () => {
      setStatsLoading(true)
      try {
        const res = await fetch(`${config.backendUrl}/api/booths/stats`, { headers: getAuthHeaders() })
        if (res.ok) setBoothStats(await res.json())
      } catch (err) {
        console.warn('Booth stats fetch failed:', err.message)
      } finally {
        setStatsLoading(false)
      }
    }
    fetchStats()
  }, [])

  // Fetch ML congestion forecast when booth changes
  useEffect(() => {
    fetchForecast()
  }, [selectedBooth])

  const fetchForecast = async () => {
    setForecastLoading(true)
    try {
      const response = await fetch(`${config.mlUrl}/predict/peak-hours/${selectedBooth}`)
      if (response.ok) {
        const result = await response.json()
        setPeakInfo(result)
        setForecastData(result.congestion_forecast)
      } else {
        useMockForecast()
      }
    } catch (error) {
      useMockForecast()
    } finally {
      setForecastLoading(false)
    }
  }

  const useMockForecast = () => {
    const mock = [15, 20, 40, 85, 90, 70, 50, 45, 80, 88, 60, 30]
    setForecastData(mock)
    setPeakInfo({ peak_hours: [85, 90, 88], quiet_hours: [15, 20, 30], recommended_slot: '14:00 - 15:00', congestion_forecast: mock })
  }

  const chartData = HOURS.map((hour, idx) => ({ time: hour, congestion: forecastData[idx] || 0 }))
  const totalVoters = boothStats.reduce((s, b) => s + b.total, 0)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-surface-800">Booth Management</h1>
        <p className="text-surface-500 mt-1">Live voter distribution and ML congestion forecasts</p>
      </div>

      {/* Live Voter Count Per Booth */}
      <div className="premium-card p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-medium text-surface-800">Voter Distribution</h2>
          <span className="text-sm font-medium text-surface-500">{totalVoters} total registered</span>
        </div>

        {statsLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {BOOTHS.map(b => {
              const stat = boothStats.find(s => s.booth_id === b.id) || { total: 0, approved: 0, pending: 0 }
              const pct = totalVoters > 0 ? Math.round((stat.total / totalVoters) * 100) : 0
              return (
                <div
                  key={b.id}
                  onClick={() => setSelectedBooth(b.id)}
                  className={`border-2 rounded-xl p-4 cursor-pointer transition-all ${
                    selectedBooth === b.id
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-surface-200 bg-white hover:border-surface-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-surface-700">{b.label}</span>
                    <span className="text-xs text-surface-400 font-medium">{pct}%</span>
                  </div>
                  <p className="text-3xl font-bold text-primary-600">{stat.total}</p>
                  <div className="flex gap-3 mt-2 text-xs text-surface-500">
                    <span className="text-green-600 font-medium">✓ {stat.approved} approved</span>
                    {stat.pending > 0 && <span className="text-amber-600 font-medium">⏳ {stat.pending} pending</span>}
                  </div>
                  {/* Mini bar */}
                  <div className="h-1.5 bg-surface-100 rounded-full mt-3 overflow-hidden">
                    <div
                      className="h-full bg-primary-500 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ML Congestion Forecast */}
      <div className="premium-card p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-medium text-surface-800">
            Congestion Forecast —{' '}
            <span className="text-primary-600">
              {BOOTHS.find(b => b.id === selectedBooth)?.label}
            </span>
          </h2>
          <button
            onClick={fetchForecast}
            className="text-sm text-surface-500 hover:text-primary-600 transition-colors"
          >
            Refresh
          </button>
        </div>

        {forecastLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e2" />
              <XAxis dataKey="time" stroke="#716d66" tick={{ fontSize: 12 }} />
              <YAxis stroke="#716d66" tick={{ fontSize: 12 }} unit="%" />
              <Tooltip
                contentStyle={{ backgroundColor: '#fff', border: '1px solid #e7e5e2', borderRadius: '12px' }}
                formatter={(value) => [`${value}%`, 'Congestion']}
              />
              <Legend wrapperStyle={{ paddingTop: '16px' }} />
              <Bar dataKey="congestion" fill="#0069c8" radius={[6, 6, 0, 0]} name="Congestion %" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Peak Info Cards */}
      {peakInfo && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-5">
            <p className="text-red-700 text-sm font-semibold mb-2">⚠️ Peak Hours</p>
            <p className="text-2xl font-bold text-red-600">{peakInfo.peak_hours.join(', ')}</p>
            <p className="text-xs text-red-400 mt-1">Congestion &gt; 70%</p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-xl p-5">
            <p className="text-green-700 text-sm font-semibold mb-2">✓ Quiet Hours</p>
            <p className="text-2xl font-bold text-green-600">{peakInfo.quiet_hours.join(', ')}</p>
            <p className="text-xs text-green-400 mt-1">Congestion &lt; 30%</p>
          </div>
          <div className="bg-primary-50 border border-primary-200 rounded-xl p-5">
            <p className="text-primary-700 text-sm font-semibold mb-2">⏰ Best Time to Vote</p>
            <p className="text-2xl font-bold text-primary-600">{peakInfo.recommended_slot}</p>
            <p className="text-xs text-primary-400 mt-1">Recommended slot</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default BoothManagement
