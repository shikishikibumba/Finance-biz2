import { useState, useEffect, useCallback } from "react";
import API from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { useTheme } from "@/contexts/ThemeContext";
import { toast } from "sonner";
import { Settings, Sun, Moon, Hash, Save } from "lucide-react";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [counters, setCounters] = useState({ invoices: 0, purchases: 0, orders: 0 });
  const [editValues, setEditValues] = useState({ invoices: "", purchases: "", orders: "" });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { data } = await API.get("/settings/counters");
      setCounters(data);
      setEditValues({
        invoices: String(data.invoices),
        purchases: String(data.purchases),
        orders: String(data.orders),
      });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const updateCounter = async (name) => {
    const v = parseInt(editValues[name], 10);
    if (Number.isNaN(v) || v < 0) { toast.error("Enter a valid non-negative number"); return; }
    try {
      const { data } = await API.put(`/settings/counters/${name}`, { value: v });
      toast.success(`Next ${name.slice(0, -1)} number will be ${data.next}`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to update counter");
    }
  };

  return (
    <div className="space-y-6" data-testid="settings-page">
      <div className="flex items-center gap-3">
        <Settings size={28} />
        <div>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight" style={{ fontFamily: 'Outfit, sans-serif' }}>Settings</h1>
          <p className="text-sm text-muted-foreground">System preferences and numbering configuration.</p>
        </div>
      </div>

      {/* Theme */}
      <Card className="border shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-start gap-3 mb-4">
            {theme === "dark" ? <Moon size={20} /> : <Sun size={20} />}
            <div>
              <h2 className="text-lg font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>Appearance</h2>
              <p className="text-xs text-muted-foreground">Choose your preferred interface theme. Saved per device.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant={theme === "light" ? "default" : "outline"}
              onClick={() => setTheme("light")}
              className={`gap-2 rounded-sm ${theme === "light" ? "bg-[#0F172A] text-white hover:bg-[#1E293B]" : ""}`}
              data-testid="theme-light-button"
            >
              <Sun size={14} /> Light
            </Button>
            <Button
              variant={theme === "dark" ? "default" : "outline"}
              onClick={() => setTheme("dark")}
              className={`gap-2 rounded-sm ${theme === "dark" ? "bg-[#0F172A] text-white hover:bg-[#1E293B]" : ""}`}
              data-testid="theme-dark-button"
            >
              <Moon size={14} /> Dark
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Numbering */}
      <Card className="border shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-start gap-3 mb-4">
            <Hash size={20} />
            <div>
              <h2 className="text-lg font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }}>Document Numbering</h2>
              <p className="text-xs text-muted-foreground">
                Set the next auto-generated number. Useful for continuing legacy numbering. Cannot be set lower than the highest existing number.
                <br />Invoices use plain numbers (e.g. <code>3756</code>); purchases use <code>PUR-NNNN</code>; orders use <code>ORD-NNNN</code>.
              </p>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {["invoices", "purchases", "orders"].map((name) => (
                <div key={name} className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider capitalize">
                    {name} — Last Used
                  </Label>
                  <div className="text-2xl font-semibold" style={{ fontFamily: 'Outfit, sans-serif' }} data-testid={`counter-${name}-value`}>
                    {counters[name]}
                  </div>
                  <div className="text-[11px] text-muted-foreground">Next will be: <b>{counters[name] + 1}</b></div>
                  <div className="flex gap-2 pt-1">
                    <Input
                      type="number"
                      min="0"
                      value={editValues[name]}
                      onChange={e => setEditValues(v => ({ ...v, [name]: e.target.value }))}
                      data-testid={`counter-${name}-input`}
                    />
                    <Button
                      onClick={() => updateCounter(name)}
                      className="bg-[#0F172A] hover:bg-[#1E293B] rounded-sm text-white gap-1"
                      data-testid={`counter-${name}-save`}
                    >
                      <Save size={14} /> Set
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border shadow-sm bg-[hsl(var(--surface-muted))]">
        <CardContent className="p-6">
          <h2 className="text-sm font-bold uppercase tracking-wider mb-2 text-muted-foreground">System Preferences</h2>
          <p className="text-xs text-muted-foreground">More preferences (currency, date format, fiscal year start) will be added as the workflow stabilises. Open an issue if you need a specific one.</p>
        </CardContent>
      </Card>
    </div>
  );
}
