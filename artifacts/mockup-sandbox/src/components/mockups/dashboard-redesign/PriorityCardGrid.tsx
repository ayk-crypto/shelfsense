import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Package,
  AlertTriangle,
  Clock,
  Trash2,
  DollarSign,
  ShoppingCart,
  TrendingUp,
  TrendingDown,
  Zap,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";

const trendData = [
  { day: "May 1", in: 42, out: 31 },
  { day: "May 2", in: 18, out: 27 },
  { day: "May 3", in: 55, out: 40 },
  { day: "May 4", in: 30, out: 35 },
  { day: "May 5", in: 70, out: 52 },
  { day: "May 6", in: 25, out: 18 },
  { day: "May 7", in: 48, out: 44 },
];

type InsightTab = "usage" | "forecast" | "slow";

export function PriorityCardGrid() {
  const [insightTab, setInsightTab] = useState<InsightTab>("usage");
  const [trendDays, setTrendDays] = useState<"7" | "14" | "30">("7");

  return (
    <div className="min-h-screen bg-[#f5f6fa] font-sans text-[#111827]">

      {/* Header */}
      <div className="px-6 pt-5 pb-4 flex items-start justify-between border-b border-[#e5e7eb] bg-white">
        <div>
          <p className="text-xs text-[#9ca3af] font-medium uppercase tracking-widest mb-0.5">Fresh Mart · 6 May 2026</p>
          <h1 className="text-2xl font-bold text-[#111827]">Dashboard</h1>
        </div>
        <button className="mt-1 flex items-center gap-2 text-sm bg-[#6366f1] text-white rounded-lg px-4 py-2 font-medium hover:bg-[#5457e0] transition-colors">
          <ShoppingCart className="w-4 h-4" />
          New Purchase Order
        </button>
      </div>

      {/* KPI Strip */}
      <div className="px-6 py-3 bg-white border-b border-[#e5e7eb] grid grid-cols-5 gap-0 divide-x divide-[#e5e7eb]">
        {[
          { label: "Inventory Value", value: "R 84,320", icon: DollarSign, color: "#6366f1", change: null },
          { label: "Total Items", value: "248", icon: Package, color: "#10b981", change: "+12 this week" },
          { label: "Low Stock", value: "8", icon: AlertTriangle, color: "#f59e0b", change: "needs reorder", alert: true },
          { label: "Expiring Soon", value: "3", icon: Clock, color: "#ef4444", change: "within 7 days", alert: true },
          { label: "Wastage (week)", value: "R 1,840", icon: Trash2, color: "#ef4444", change: "↑ 29% vs last wk", alert: true },
        ].map((kpi) => (
          <div key={kpi.label} className="flex items-center gap-3 px-5 py-3 first:pl-0">
            <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: kpi.color + "15" }}>
              <kpi.icon className="w-4 h-4" style={{ color: kpi.color }} />
            </div>
            <div>
              <p className="text-xs text-[#9ca3af]">{kpi.label}</p>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold text-[#111827]">{kpi.value}</span>
                {kpi.change && (
                  <span className={`text-[10px] ${kpi.alert ? "text-red-500" : "text-green-600"}`}>{kpi.change}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="px-6 py-4 space-y-4">

        {/* Priority row: Alerts + Wastage + Reorder */}
        <div className="grid grid-cols-3 gap-4">

          {/* Urgent Alerts */}
          <div className="bg-white rounded-xl border border-[#fca5a5] shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-red-50 border-b border-[#fca5a5] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-red-600" />
                <h2 className="text-sm font-semibold text-red-900">Requires Attention</h2>
              </div>
              <span className="text-xs bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center font-bold">12</span>
            </div>
            <div className="p-3 space-y-2">
              <div className="flex items-center justify-between bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs font-medium text-red-900">Greek Yogurt 250g</p>
                  <p className="text-[10px] text-red-600">Batch B-041 · 18 remaining</p>
                </div>
                <span className="text-[10px] font-bold bg-red-600 text-white px-2 py-0.5 rounded-full">1 day</span>
              </div>
              <div className="flex items-center justify-between bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs font-medium text-[#111827]">Fresh Cream 200ml</p>
                  <p className="text-[10px] text-[#6b7280]">Batch B-038 · 6 remaining</p>
                </div>
                <span className="text-[10px] font-semibold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">2 days</span>
              </div>
              <div className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs font-medium text-[#111827]">Orange Juice 1L</p>
                  <p className="text-[10px] text-[#6b7280]">Batch B-033 · 24 remaining</p>
                </div>
                <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">4 days</span>
              </div>
              <button className="w-full text-[11px] text-[#6366f1] font-medium mt-1 flex items-center justify-center gap-1 py-1 hover:bg-indigo-50 rounded-lg transition-colors">
                View all 12 alerts <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Reorder Suggestions */}
          <div className="bg-white rounded-xl border border-[#fde68a] shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-amber-50 border-b border-[#fde68a] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-amber-700" />
                <h2 className="text-sm font-semibold text-amber-900">Reorder Needed</h2>
              </div>
              <span className="text-xs bg-amber-500 text-white rounded-full w-5 h-5 flex items-center justify-center font-bold">8</span>
            </div>
            <div className="p-3 space-y-2">
              {[
                { name: "Whole Milk (1L)", current: 4, min: 20, suggest: 40 },
                { name: "Cheddar Cheese 500g", current: 2, min: 10, suggest: 20 },
                { name: "White Bread Loaf", current: 6, min: 15, suggest: 30 },
              ].map((item) => (
                <div key={item.name} className="flex items-center justify-between py-2 border-b border-[#f9fafb] last:border-0">
                  <div>
                    <p className="text-xs font-medium text-[#111827]">{item.name}</p>
                    <p className="text-[10px] text-[#6b7280]">On hand: <span className="text-amber-600 font-semibold">{item.current}</span> · Min: {item.min}</p>
                  </div>
                  <span className="text-xs font-bold text-[#111827] bg-[#f3f4f6] px-2 py-0.5 rounded">+{item.suggest}</span>
                </div>
              ))}
              <button className="w-full text-xs bg-amber-500 text-white font-medium py-2 rounded-lg hover:bg-amber-600 transition-colors flex items-center justify-center gap-1.5 mt-1">
                <ShoppingCart className="w-3 h-3" /> Create PO Draft
              </button>
            </div>
          </div>

          {/* Wastage */}
          <div className="bg-white rounded-xl border border-[#e5e7eb] shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-[#e5e7eb] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-red-500" />
                <h2 className="text-sm font-semibold text-[#111827]">Wastage</h2>
              </div>
              <div className="flex items-center gap-1 text-xs text-red-500 font-medium">
                <TrendingUp className="w-3 h-3" /> +29%
              </div>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-3 gap-2 mb-3">
                <div className="text-center bg-[#f9fafb] rounded-lg py-2">
                  <p className="text-[10px] text-[#9ca3af]">Today</p>
                  <p className="text-sm font-bold text-[#374151]">R 240</p>
                </div>
                <div className="text-center bg-red-50 rounded-lg py-2">
                  <p className="text-[10px] text-[#9ca3af]">This week</p>
                  <p className="text-sm font-bold text-red-600">R 1,840</p>
                </div>
                <div className="text-center bg-[#f9fafb] rounded-lg py-2">
                  <p className="text-[10px] text-[#9ca3af]">Last week</p>
                  <p className="text-sm font-bold text-[#6b7280]">R 1,420</p>
                </div>
              </div>
              <p className="text-[10px] font-medium text-[#6b7280] uppercase tracking-wide mb-2">Top wasted this week</p>
              <div className="space-y-1.5">
                {[
                  { name: "Greek Yogurt 250g", val: "R 600" },
                  { name: "Fresh Cream 200ml", val: "R 450" },
                  { name: "Whole Milk (1L)", val: "R 210" },
                ].map((item, i) => (
                  <div key={item.name} className="flex items-center gap-2 text-xs">
                    <span className="text-[10px] text-[#9ca3af] font-medium w-4">#{i + 1}</span>
                    <span className="flex-1 text-[#374151] truncate">{item.name}</span>
                    <span className="font-semibold text-red-500">{item.val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Movement chart */}
        <div className="bg-white rounded-xl border border-[#e5e7eb] shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[#111827]">Movement Trends</h2>
            <div className="flex bg-[#f3f4f6] rounded-lg p-0.5 gap-0.5">
              {(["7", "14", "30"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setTrendDays(d)}
                  className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${trendDays === d ? "bg-white text-[#111827] shadow-sm" : "text-[#6b7280]"}`}
                >
                  {d} days
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={trendData} barSize={14} barGap={3}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={28} />
              <Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e5e7eb", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
                cursor={{ fill: "#f9fafb" }}
              />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="in" name="Stock In" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="out" name="Stock Out" fill="#c7d2fe" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Tabbed Insights */}
        <div className="bg-white rounded-xl border border-[#e5e7eb] shadow-sm overflow-hidden">
          <div className="flex items-center border-b border-[#e5e7eb] px-4 gap-1">
            {(["usage", "forecast", "slow"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setInsightTab(tab)}
                className={`px-4 py-3 text-xs font-medium transition-colors ${insightTab === tab ? "text-[#6366f1] border-b-2 border-[#6366f1]" : "text-[#6b7280] hover:text-[#374151]"}`}
              >
                {tab === "usage" ? "📊 Usage Insights" : tab === "forecast" ? "🔮 Stock Forecast" : "🐢 Slow Movers"}
              </button>
            ))}
            <div className="ml-auto">
              <span className="text-[10px] text-[#9ca3af]">Last 7 days</span>
            </div>
          </div>

          <div className="p-4">
            {insightTab === "usage" && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[#6b7280]">
                    <th className="text-left pb-2 font-medium">Item</th>
                    <th className="text-right pb-2 font-medium">Units Used</th>
                    <th className="text-right pb-2 font-medium">Est. Value</th>
                    <th className="text-right pb-2 font-medium">Daily Avg</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f3f4f6]">
                  {[
                    { name: "Whole Milk (1L)", used: 186, value: "R 1,302", avg: "26.6/day" },
                    { name: "White Bread Loaf", used: 142, value: "R 2,840", avg: "20.3/day" },
                    { name: "Greek Yogurt 250g", used: 98, value: "R 2,450", avg: "14/day" },
                    { name: "Cheddar Cheese 500g", used: 54, value: "R 1,620", avg: "7.7/day" },
                  ].map((item) => (
                    <tr key={item.name}>
                      <td className="py-2 font-medium text-[#111827]">{item.name}</td>
                      <td className="py-2 text-right text-[#374151]">{item.used}</td>
                      <td className="py-2 text-right text-[#374151]">{item.value}</td>
                      <td className="py-2 text-right font-semibold text-[#6366f1]">{item.avg}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {insightTab === "forecast" && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[#6b7280]">
                    <th className="text-left pb-2 font-medium">Item</th>
                    <th className="text-right pb-2 font-medium">In Stock</th>
                    <th className="text-right pb-2 font-medium">Avg / Day</th>
                    <th className="text-right pb-2 font-medium">Est. Days Left</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f3f4f6]">
                  {[
                    { name: "Whole Milk (1L)", stock: 4, avg: "26.6", days: "<1", tone: "critical" },
                    { name: "Cheddar Cheese 500g", stock: 2, avg: "7.7", days: "<1", tone: "critical" },
                    { name: "White Bread Loaf", stock: 6, avg: "20.3", days: "~0.3", tone: "warn" },
                    { name: "Greek Yogurt 250g", stock: 18, avg: "14", days: "~1.3", tone: "warn" },
                    { name: "Coconut Oil 500ml", stock: 8, avg: "0.3", days: "27", tone: "ok" },
                  ].map((item) => (
                    <tr key={item.name}>
                      <td className="py-2 font-medium text-[#111827]">{item.name}</td>
                      <td className="py-2 text-right text-[#374151]">{item.stock}</td>
                      <td className="py-2 text-right text-[#6b7280]">{item.avg}</td>
                      <td className="py-2 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${item.tone === "critical" ? "bg-red-100 text-red-700" : item.tone === "warn" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
                          {item.days} days
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {insightTab === "slow" && (
              <div>
                <div className="flex items-center gap-2 mb-3 text-xs text-[#6b7280]">
                  <span>3 items with stock but no movement in 7 days</span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[#6b7280]">
                      <th className="text-left pb-2 font-medium">Item</th>
                      <th className="text-right pb-2 font-medium">In Stock</th>
                      <th className="text-right pb-2 font-medium">Value Tied Up</th>
                      <th className="text-right pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f3f4f6]">
                    {[
                      { name: "Dried Apricots 500g", qty: 32, value: "R 960" },
                      { name: "Quinoa 1kg", qty: 14, value: "R 1,260" },
                      { name: "Coconut Oil 500ml", qty: 8, value: "R 560" },
                    ].map((item) => (
                      <tr key={item.name}>
                        <td className="py-2 font-medium text-[#111827]">{item.name}</td>
                        <td className="py-2 text-right text-[#374151]">{item.qty}</td>
                        <td className="py-2 text-right text-[#374151]">{item.value}</td>
                        <td className="py-2 text-right">
                          <span className="text-[10px] bg-[#f3f4f6] text-[#6b7280] px-2 py-0.5 rounded-full">No movement · 7d</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
