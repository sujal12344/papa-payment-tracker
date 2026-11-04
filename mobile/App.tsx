import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, FlatList, Pressable, SafeAreaView,
  StyleSheet, Text, View, RefreshControl
} from "react-native";
import { StatusBar } from "expo-status-bar";

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || "http://192.168.1.20:4000";

type Payment = {
  id: string;
  amount: number;
  direction: "credit" | "debit" | "unknown";
  payerName: string;
  senderId: string;
  timestamp: number;
  transactionId: string | null;
};

type ApiResponse = {
  success: boolean;
  totalReceived: number;
  transactionCount: number;
  lastRefreshedAt: string;
  sourceStatus: string;
  payments: Payment[];
};

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);

export default function App() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/api/payments/today`);
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      const json = await response.json();
      setData(json);
    } catch {
      setError("Payments load nahi ho paaye. Internet/API connection check karein.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const payments = data?.payments || [];

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>PAPA'S BUSINESS</Text>
            <Text style={styles.title}>Payment Tracker</Text>
            <Text style={styles.date}>{new Date().toLocaleDateString("en-IN", {
              weekday: "long", day: "numeric", month: "long", year: "numeric"
            })}</Text>
          </View>
          <View style={styles.status}><View style={styles.dot} /><Text style={styles.statusText}>Tracker</Text></View>
        </View>

        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>Aaj total received</Text>
          <Text style={styles.total}>{money(data?.totalReceived || 0)}</Text>
          <Text style={styles.totalSub}>{data?.transactionCount || 0} received payments</Text>
        </View>

        <Pressable style={styles.refresh} onPress={refresh} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.refreshText}>↻   Refresh payments</Text>}
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Today's transactions</Text>
          <Text style={styles.count}>{payments.length}</Text>
        </View>

        <FlatList
          data={payments}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}
          contentContainerStyle={payments.length ? styles.list : styles.emptyList}
          ListEmptyComponent={<Text style={styles.empty}>Abhi koi payment record nahi hai.</Text>}
          renderItem={({ item }) => {
            const isCredit = item.direction === "credit";
            return (
              <View style={styles.payment}>
                <View style={[styles.icon, isCredit ? styles.creditIcon : styles.otherIcon]}>
                  <Text style={{ color: isCredit ? "#087443" : "#9A5A00", fontSize: 19 }}>
                    {isCredit ? "↓" : "↗"}
                  </Text>
                </View>
                <View style={styles.details}>
                  <Text style={styles.name}>{item.payerName}</Text>
                  <Text style={styles.meta}>
                    {new Date(item.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    {" · "}{item.senderId}
                  </Text>
                  {item.transactionId ? <Text style={styles.ref}>Ref: {item.transactionId}</Text> : null}
                </View>
                <Text style={[styles.amount, { color: isCredit ? "#087443" : "#303744" }]}>
                  {isCredit ? "+" : ""}{money(item.amount)}
                </Text>
              </View>
            );
          }}
        />
        <Text style={styles.footer}>
          {data?.lastRefreshedAt
            ? `Last refreshed: ${new Date(data.lastRefreshedAt).toLocaleTimeString("en-IN")}`
            : "Refresh to fetch latest SMS"}
          {"  ·  "}SMS-reported, not bank-verified
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F5F7F8" },
  container: { flex: 1, paddingHorizontal: 20, paddingTop: 18 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 22 },
  kicker: { color: "#64748B", fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  title: { color: "#17212B", fontSize: 27, fontWeight: "800", marginTop: 3 },
  date: { color: "#64748B", fontSize: 13, marginTop: 5 },
  status: { flexDirection: "row", alignItems: "center", backgroundColor: "#E5F6ED", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 20 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#15945B", marginRight: 6 },
  statusText: { color: "#087443", fontWeight: "700", fontSize: 12 },
  totalCard: { backgroundColor: "#0D7650", borderRadius: 20, padding: 22, marginBottom: 14 },
  totalLabel: { color: "#D4F3E4", fontSize: 14, fontWeight: "600" },
  total: { color: "#FFFFFF", fontSize: 36, fontWeight: "800", marginTop: 7 },
  totalSub: { color: "#D4F3E4", marginTop: 5, fontSize: 13 },
  refresh: { backgroundColor: "#17212B", borderRadius: 14, minHeight: 52, justifyContent: "center", alignItems: "center", marginBottom: 22 },
  refreshText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  error: { color: "#B42318", marginBottom: 12 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sectionTitle: { color: "#17212B", fontSize: 18, fontWeight: "800" },
  count: { color: "#475569", backgroundColor: "#E7EBEF", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, fontWeight: "700" },
  list: { paddingBottom: 12 },
  emptyList: { flexGrow: 1, justifyContent: "center" },
  empty: { color: "#64748B", textAlign: "center", padding: 30 },
  payment: { backgroundColor: "#FFFFFF", borderRadius: 15, padding: 13, marginBottom: 9, flexDirection: "row", alignItems: "center" },
  icon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", marginRight: 11 },
  creditIcon: { backgroundColor: "#E5F6ED" },
  otherIcon: { backgroundColor: "#FFF1D9" },
  details: { flex: 1 },
  name: { color: "#17212B", fontSize: 14, fontWeight: "700" },
  meta: { color: "#64748B", fontSize: 11, marginTop: 4 },
  ref: { color: "#94A3B8", fontSize: 10, marginTop: 3 },
  amount: { fontSize: 14, fontWeight: "800", marginLeft: 7 },
  footer: { color: "#94A3B8", fontSize: 10, textAlign: "center", paddingVertical: 12 }
});
