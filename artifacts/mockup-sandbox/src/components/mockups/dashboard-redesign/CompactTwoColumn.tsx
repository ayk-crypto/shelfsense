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
  TrendingUp,
  TrendingDown,
  Package,
  AlertTriangle,
  Clock,
  Trash2,
  DollarSign,
  ShoppingCart,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
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

const reorderItems = [
  { name: "Whole Milk (1L)", current: 4, min: 20, suggest: 40, unit: "units" },
  { name: "Cheddar Cheese 500g", current: 2, min: 10, suggest: 20, unit: "pcs" },
  { name: "White Bread Loaf", current: 6, min: 15, suggest: 30, unit: "loaves" },
];

const expiryItems = [
  { name: "Greek Yogurt 250g", qty: 18, days: 1, batch: "B-2024-041" },
  { name: "Fresh Cream 200ml", qty: 6, days: 2, batch: "B-2024-038" },
  { name: "Orange Juice 1L", qty: 24, days: 4, batch: "B-2024-033" },
];

const usageData = [
  { name: "Whole Milk (1L)", used: 186, value: "R 1,302", avg: "26.6/day" },
  { name: "White Bread Loaf", used: 142, value: "R 2,840", avg: "20.3/day" },
  { name: "Greek Yogurt 250g", used: 98, value: "R 2,450", avg: "14/day" },
  { name: "Cheddar Cheese 500g", used: 54, value: "R 1,620", avg: "7.7/day" },
];

const slowMovers = [
  { name: "Dried Apricots 500g", qty: 32, value: "R 960" },
  { name: "Quinoa 1kg", qty: 14, value: "R 1,260" },
  { name: "Coconut Oil 500ml", qty: 8, value: "R 560" },
];

type InsightTab = "usage" | "forecast" | "slow";

export function CompactTwoColumn() {
  const [insightTab, setInsightTab] = useState<InsightTab>("usage");
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [trendDays, setTrendDays] = useState<"7" | "14" | "30">("7");

  return (
    <div className="min-h-screen bg-[#f5f6fa] font-sans text-[#111827]">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#111827]">Today's operations</h1>
          <p className="text-sm text-[#6b7280] mt-0.5">Fresh Mart inventory health · 6 May 2026</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-green-50 text-green-700 border border-green-200 rounded-full px-3 py-1 font-medium">All systems normal</span>
          <button className="text-sm bg-[#6366f1] text-white rounded-lg px-4 py-2 font-medium hover:bg-[#5457e0] transition-colors">
            Create Purchase Order
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="px-6 grid grid-cols-5 gap-3 mb-4">
        {[
          { label: "Inventory Value", value: "R 84,320", icon: DollarSign, color: "text-[#6366f1]", bg: "bg-indigo-50", sub: null },
          { label: "Total Items", value: "248", icon: Package, color: "text-green-600", bg: "bg-green-50", sub: null },
          { label: "Low Stock", value: "8", icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50", sub: "needs reorder" },
          { label: "Expiring Soon", value: "3", icon: Clock, color: "text-red-500", bg: "bg-red-50", sub: "within 7 days" },
          { label: "Wastage (week)", value: "R 1,840", icon: Trash2, color: "text-red-500", bg: "bg-red-50", sub: "↑ R 420 vs last wk" },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-[#e5e7eb] px-4 py-3 flex items-center gap-3 shadow-sm">
            <div className={`${card.bg} rounded-lg p-2 flex-shrink-0`}>
              <card.icon className={`w-4 h-4 ${card.color}`} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-[#6b7280] truncate">{card.label}</p>
              <p className="text-base font-semibold text-[#111827]">{card.value}</p>
              {card.sub && <p className="text-[10px] text-red-500">{card.sub}</p>}
            </div>
          </div>
        ))}
      </div>

      {/* Two-column body */}
      <div className="px-6 grid grid-cols-[1fr_1fr] gap-4 mb-4">

        {/* LEFT: Action Required */}
        <div className="flex flex-col gap-3">

          {/* Alert summary */}
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[#111827]">Action Required</h2>
              <div className="flex gap-1.5">
                <span className="text-xs bg-amber-100 text-amber-800 border border-amber-200 rounded-full px-2 py-0.5">8 low stock</span>
                <span className="text-xs bg-orange-100 text-orange-800 border border-orange-200 rounded-full px-2 py-0.5">3 expiring</span>
                <span className="text-xs bg-red-100 text-red-800 border border-red-200 rounded-full px-2 py-0.5">1 expired</span>
              </div>
            </div>
            {/* Expiry alerts compact */}
            <div className="space-y-2 mb-3">
              <p className="text-xs font-medium text-[#6b7280] uppercase tracking-wide">Expiring within 7 days</p>
              {expiryItems.map((item) => (
                <div key={item.name} className="flex items-center justify-between bg-red-50 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-xs font-medium text-[#111827]">{item.name}</p>
                    <p className="text-[10px] text-[#6b7280]">Batch {item.batch} · {item.qty} remaining</p>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${item.days <= 1 ? "bg-red-600 text-white" : item.days <= 2 ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}`}>
                    {item.days === 1 ? "1 day left" : `${item.days} days`}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Reorder suggestions */}
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-4 shadow-sm flex-1">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[#111827]">Reorder Suggestions</h2>
              <button className="text-xs text-[#6366f1] font-medium hover:underline flex items-center gap-1">
                <ShoppingCart className="w-3 h-3" /> Create PO Draft
              </button>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[#6b7280]">
                  <th className="text-left pb-2 font-medium">Item</th>
                  <th className="text-right pb-2 font-medium">On Hand</th>
                  <th className="text-right pb-2 font-medium">Min Level</th>
                  <th className="text-right pb-2 font-medium">Suggest</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f3f4f6]">
                {reorderItems.map((item) => (
                  <tr key={item.name}>
                    <td className="py-2 font-medium text-[#111827]">{item.name}</td>
                    <td className="py-2 text-right text-amber-600 font-semibold">{item.current}</td>
                    <td className="py-2 text-right text-[#6b7280]">{item.min}</td>
                    <td className="py-2 text-right font-bold text-[#111827]">{item.suggest}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-[#9ca3af] mt-2">Showing 3 of 8 items · <span className="text-[#6366f1] cursor-pointer">View all reorder suggestions →</span></p>
          </div>
        </div>

        {/* RIGHT: Chart + Wastage */}
        <div className="flex flex-col gap-3">
          {/* Movement chart */}
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[#111827]">Movement Trends</h2>
              <div className="flex bg-[#f3f4f6] rounded-lg p-0.5 gap-0.5">
                {(["7", "14", "30"] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setTrendDays(d)}
                    className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${trendDays === d ? "bg-white text-[#111827] shadow-sm" : "text-[#6b7280]"}`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={trendData} barSize={10} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={28} />
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e5e7eb", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
                  cursor={{ fill: "#f9fafb" }}
                />
                <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="in" name="Stock In" fill="#6366f1" radius={[3, 3, 0, 0]} />
                <Bar dataKey="out" name="Stock Out" fill="#e0e7ff" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Wastage */}
          <div className="bg-white rounded-xl border border-[#e5e7eb] p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-[#111827]">Wastage This Week</h2>
              <div className="flex items-center gap-1 text-red-500 text-xs font-medium">
                <TrendingUp className="w-3 h-3" /> +29% vs last week
              </div>
            </div>
            <div className="flex gap-4 mb-3">
              <div>
                <p className="text-[10px] text-[#6b7280]">This week</p>
                <p className="text-lg font-bold text-red-600">R 1,840</p>
              </div>
              <div>
                <p className="text-[10px] text-[#6b7280]">Today</p>
                <p className="text-lg font-bold text-[#111827]">R 240</p>
              </div>
              <div>
                <p className="text-[10px] text-[#6b7280]">Last week</p>
                <p className="text-lg font-bold text-[#6b7280]">R 1,420</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium text-[#6b7280] uppercase tracking-wide">Top wasted items</p>
              {[
                { name: "Greek Yogurt 250g", qty: 24, val: "R 600" },
                { name: "Fresh Cream 200ml", qty: 18, val: "R 450" },
                { name: "Whole Milk (1L)", qty: 30, val: "R 210" },
              ].map((item, i) => (
                <div key={item.name} className="flex items-center gap-2 text-xs">
                  <span className="w-4 h-4 rounded-full bg-[#f3f4f6] text-[#6b7280] text-[10px] flex items-center justify-center font-medium">#{i + 1}</span>
                  <span className="flex-1 text-[#374151]">{item.name}</span>
                  <span className="text-[#6b7280]">{item.qty} units</span>
                  <span className="font-semibold text-red-600">{item.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Collapsible Insights */}
      <div className="px-6 mb-6">
        <div className="bg-white rounded-xl border border-[#e5e7eb] shadow-sm overflow-hidden">
          <button
            onClick={() => setInsightsOpen(!insightsOpen)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-[#111827] hover:bg-[#f9fafb] transition-colors"
          >
            <span className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#6366f1]" />
              Deep Insights
              <span className="text-xs font-normal text-[#9ca3af]">Usage · Forecast · Slow movers</span>
            </span>
            {insightsOpen ? <ChevronUp className="w-4 h-4 text-[#9ca3af]" /> : <ChevronDown className="w-4 h-4 text-[#9ca3af]" />}
          </button>

          {insightsOpen && (
            <div className="border-t border-[#e5e7eb]">
              <div className="flex border-b border-[#e5e7eb]">
                {(["usage", "forecast", "slow"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setInsightTab(tab)}
                    className={`px-5 py-2.5 text-xs font-medium capitalize transition-colors ${insightTab === tab ? "text-[#6366f1] border-b-2 border-[#6366f1] -mb-px" : "text-[#6b7280] hover:text-[#374151]"}`}
                  >
                    {tab === "usage" ? "Usage Insights" : tab === "forecast" ? "Stock Forecast" : "Slow Movers"}
                  </button>
                ))}
              </div>

              <div className="p-4">
                {insightTab === "usage" && (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[#6b7280]">
                        <th className="text-left pb-2 font-medium">Item</th>
                        <th className="text-right pb-2 font-medium">Total Used</th>
                        <th className="text-right pb-2 font-medium">Est. Value</th>
                        <th className="text-right pb-2 font-medium">Avg / Day</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f3f4f6]">
                      {usageData.map((item) => (
                        <tr key={item.name}>
                          <td className="py-2 font-medium text-[#111827]">{item.name}</td>
                          <td className="py-2 text-right text-[#374151]">{item.used}</td>
                          <td className="py-2 text-right text-[#374151]">{item.value}</td>
                          <td className="py-2 text-right font-medium text-[#6366f1]">{item.avg}</td>
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
                        { name: "Whole Milk (1L)", stock: 4, avg: "26.6", days: 0, tone: "critical" },
                        { name: "Cheddar Cheese 500g", stock: 2, avg: "7.7", days: 0, tone: "critical" },
                        { name: "White Bread Loaf", stock: 6, avg: "20.3", days: 0, tone: "warn" },
                        { name: "Greek Yogurt 250g", stock: 18, avg: "14", days: 1, tone: "warn" },
                        { name: "Coconut Oil 500ml", stock: 8, avg: "0.3", days: 27, tone: "ok" },
                      ].map((item) => (
                        <tr key={item.name}>
                          <td className="py-2 font-medium text-[#111827]">{item.name}</td>
                          <td className="py-2 text-right text-[#374151]">{item.stock}</td>
                          <td className="py-2 text-right text-[#6b7280]">{item.avg}</td>
                          <td className="py-2 text-right">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${item.tone === "critical" ? "bg-red-100 text-red-700" : item.tone === "warn" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
                              {item.days === 0 ? "<1 day" : `${item.days} day${item.days !== 1 ? "s" : ""}`}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {insightTab === "slow" && (
                  <div>
                    {slowMovers.length === 0 ? (
                      <div className="flex items-center gap-2 text-sm text-green-600 py-2">
                        <CheckCircle2 className="w-4 h-4" />
                        All stocked items had movement in the last 7 days.
                      </div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-[#6b7280]">
                            <th className="text-left pb-2 font-medium">Item</th>
                            <th className="text-right pb-2 font-medium">In Stock</th>
                            <th className="text-right pb-2 font-medium">Value Tied Up</th>
                            <th className="text-left pb-2 pl-4 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#f3f4f6]">
                          {slowMovers.map((item) => (
                            <tr key={item.name}>
                              <td className="py-2 font-medium text-[#111827]">{item.name}</td>
                              <td className="py-2 text-right text-[#374151]">{item.qty}</td>
                              <td className="py-2 text-right text-[#374151]">{item.value}</td>
                              <td className="py-2 pl-4">
                                <span className="text-[10px] bg-[#f3f4f6] text-[#6b7280] px-2 py-0.5 rounded-full">No movement · 7 days</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
