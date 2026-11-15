import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as Speech from "expo-speech";

declare const process: any;

type Payment = {
  id: string;
  amount: number;
  direction: "credit" | "debit" | "unknown";
  payerName: string;
  senderId: string;
  timestamp: number;
  transactionId: string | null;
  rawMessage?: string;
  createdAt?: string;
};

type ApiResponse = {
  success: boolean;
  date: string;
  totalReceived: number;
  transactionCount: number;
  todayDebitCount?: number;
  yesterdayTotal?: number;
  yesterdayCount?: number;
  allTimeTotal?: number;
  allTimeCount?: number;
  newPaymentsCount?: number;
  lastRefreshedAt: string;
  sourceStatus: string;
  dbType?: string;
  payments: Payment[];
};

const getInitialApiBase = () => {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const host = window.location.hostname || "localhost";
    return `http://${host}:4000`;
  }
  return process.env.EXPO_PUBLIC_API_BASE_URL || "https://papa-payment-server-api.onrender.com";
};

const money = (value: number) => {
  const hasDecimals = Math.abs(value % 1) > 0.001;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatHindiAmount = (amount: number) => {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  if (paise > 0 && rupees > 0) {
    return `${rupees} रुपये ${paise} पैसे`;
  } else if (paise > 0 && rupees === 0) {
    return `${paise} पैसे`;
  }
  return `${rupees} रुपये`;
};

const formatRomanHindiAmount = (amount: number) => {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  if (paise > 0 && rupees > 0) {
    return `${rupees} rupaye, ${paise} paise`;
  } else if (paise > 0 && rupees === 0) {
    return `${paise} paise`;
  }
  return `${rupees} rupaye`;
};

const speakAnnouncement = (amount: number, name: string) => {
  const hasName = name && name !== "Customer / UPI" && !name.toLowerCase().includes("customer");
  const cleanCustomerName = hasName ? name.split(" ")[0] : "";
  const formattedAmount = formatHindiAmount(amount);

  const hindiText = hasName
    ? `${cleanCustomerName} से, पापा की दुकान पर, ${formattedAmount}, प्राप्त हुए।`
    : `पापा की दुकान पर, ${formattedAmount}, प्राप्त हुए।`;

  // 1. Native Mobile (Android APK) via expo-speech
  try {
    Speech.stop();
    Speech.speak(hindiText, {
      language: "hi-IN",
      rate: 0.85,
      pitch: 1.0,
    });
  } catch (err) {
    console.warn("Native speech notice:", err);
  }

  // 2. Web browser fallback
  if (Platform.OS === "web" && typeof window !== "undefined" && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
      const voices = window.speechSynthesis.getVoices() || [];
      const hindiVoice = voices.find(
        (v) => v.lang === "hi-IN" || v.lang.startsWith("hi") || v.name.includes("हिन्दी")
      );
      const indianMaleVoice = voices.find(
        (v) =>
          (v.lang === "en-IN" || v.lang.includes("IN")) &&
          (v.name.toLowerCase().includes("ravi") ||
            v.name.toLowerCase().includes("male") ||
            v.name.toLowerCase().includes("hemant"))
      );
      const chosenVoice = hindiVoice || indianMaleVoice;
      const isPureHindiVoice = Boolean(hindiVoice && chosenVoice === hindiVoice);

      let textToSpeak = "";
      if (isPureHindiVoice) {
        textToSpeak = hindiText;
      } else {
        const formattedRoman = formatRomanHindiAmount(amount);
        textToSpeak = hasName
          ? `${cleanCustomerName} se, Papa ki dukaan par, ${formattedRoman}, praapt hue.`
          : `Papa ki dukaan par, ${formattedRoman}, praapt hue.`;
      }

      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      if (chosenVoice) {
        utterance.voice = chosenVoice;
        utterance.lang = chosenVoice.lang;
      } else {
        utterance.lang = "en-IN";
      }
      utterance.rate = 0.80;
      utterance.pitch = 0.95;
      window.speechSynthesis.speak(utterance);
    } catch {}
  }
};

// Date helpers (YYYY-MM-DD)
const toDateStr = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const formatShortDate = (dateStr: string) => {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  const dateObj = new Date(y, m - 1, d);
  return dateObj.toLocaleDateString("hi-IN", { day: "numeric", month: "short" });
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const DAY_LETTERS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export type ActiveDateFilter =
  | { mode: "today" }
  | { mode: "yesterday" }
  | { mode: "week" }
  | { mode: "month" }
  | { mode: "all" }
  | { mode: "single"; date: string }
  | { mode: "range"; start: string; end: string }
  | { mode: "multi"; dates: string[] };

function MainTracker() {
  const [apiBase, setApiBase] = useState(getInitialApiBase);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Bank Filter: "all" | "slice" | "kotak"
  const [bankFilter, setBankFilter] = useState<"all" | "slice" | "kotak">("all");

  // Date Filter State
  const [activeDateFilter, setActiveDateFilter] = useState<ActiveDateFilter>({ mode: "today" });

  // Calendar Modal State
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calMode, setCalMode] = useState<"range" | "multi" | "single">("range");
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());

  // In-modal draft selections
  const [draftRangeStart, setDraftRangeStart] = useState<string | null>(null);
  const [draftRangeEnd, setDraftRangeEnd] = useState<string | null>(null);
  const [draftMultiDates, setDraftMultiDates] = useState<string[]>([]);
  const [draftSingleDate, setDraftSingleDate] = useState<string | null>(null);

  // Direction & Search filters
  const [typeFilter, setTypeFilter] = useState<"all" | "credit" | "debit">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals & Settings
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [customUrlInput, setCustomUrlInput] = useState(apiBase);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [newAlert, setNewAlert] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);

  const fetchPayments = useCallback(
    async (urlToUse?: string) => {
      const base = (urlToUse || apiBase).trim().replace(/\/+$/, "");
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${base}/api/payments/today`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const json: ApiResponse = await response.json();
        setData(json);

        if (json.newPaymentsCount && json.newPaymentsCount > 0) {
          const firstNew = json.payments[0];
          setNewAlert(`🎉 ${json.newPaymentsCount} Nayi Payment Add Hui!`);
          if (soundEnabled && firstNew && firstNew.direction === "credit") {
            speakAnnouncement(firstNew.amount, firstNew.payerName);
          }
          setTimeout(() => setNewAlert(null), 6000);
        }
      } catch (err: any) {
        setError(`Server (${base}) se connect nahi ho raha. Check karein.`);
      } finally {
        setLoading(false);
      }
    },
    [apiBase, soundEnabled]
  );

  useEffect(() => {
    fetchPayments();
    if (Platform.OS === "web" && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
      if ("onvoiceschanged" in window.speechSynthesis) {
        window.speechSynthesis.onvoiceschanged = () => {
          window.speechSynthesis.getVoices();
        };
      }
    }
  }, [fetchPayments]);

  const testConnection = async (targetUrl: string) => {
    setTestingConnection(true);
    setTestResult(null);
    try {
      const trimmed = targetUrl.trim().replace(/\/+$/, "");
      const res = await fetch(`${trimmed}/api/health`);
      if (res.ok) {
        setTestResult("success:Connected! Server active hai.");
      } else {
        setTestResult(`error:Server error (HTTP ${res.status})`);
      }
    } catch {
      setTestResult("error:Connection fail! URL check karein.");
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSaveSettings = () => {
    const trimmed = customUrlInput.trim().replace(/\/+$/, "");
    if (trimmed) {
      setApiBase(trimmed);
      setSettingsOpen(false);
      fetchPayments(trimmed);
    }
  };

  const allPayments = data?.payments || [];

  // Dates present with transactions in SQLite DB
  const datesWithTransactions = useMemo(() => {
    const set = new Set<string>();
    allPayments.forEach((p) => {
      set.add(toDateStr(new Date(p.timestamp)));
    });
    return set;
  }, [allPayments]);

  const todayStr = useMemo(() => toDateStr(new Date()), []);
  const yesterdayStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return toDateStr(d);
  }, []);

  // Open Calendar Picker Modal and prepopulate draft selections
  const openCalendar = () => {
    const now = new Date();
    setCalMonth(now.getMonth());
    setCalYear(now.getFullYear());

    if (activeDateFilter.mode === "range") {
      setCalMode("range");
      setDraftRangeStart(activeDateFilter.start);
      setDraftRangeEnd(activeDateFilter.end);
    } else if (activeDateFilter.mode === "multi") {
      setCalMode("multi");
      setDraftMultiDates([...activeDateFilter.dates]);
    } else if (activeDateFilter.mode === "single") {
      setCalMode("single");
      setDraftSingleDate(activeDateFilter.date);
    } else if (activeDateFilter.mode === "today") {
      setCalMode("range");
      setDraftRangeStart(todayStr);
      setDraftRangeEnd(todayStr);
      setDraftSingleDate(todayStr);
      setDraftMultiDates([todayStr]);
    } else {
      setCalMode("range");
      setDraftRangeStart(null);
      setDraftRangeEnd(null);
      setDraftSingleDate(null);
      setDraftMultiDates([]);
    }

    setCalendarOpen(true);
  };

  // Calendar Day Click Handler based on calMode
  const handleCalendarDayClick = (dateStr: string) => {
    if (calMode === "range") {
      if (!draftRangeStart || (draftRangeStart && draftRangeEnd)) {
        // Start new range
        setDraftRangeStart(dateStr);
        setDraftRangeEnd(null);
      } else {
        // Second click completes range
        if (dateStr < draftRangeStart) {
          setDraftRangeEnd(draftRangeStart);
          setDraftRangeStart(dateStr);
        } else {
          setDraftRangeEnd(dateStr);
        }
      }
    } else if (calMode === "multi") {
      // Toggle date in array
      if (draftMultiDates.includes(dateStr)) {
        setDraftMultiDates(draftMultiDates.filter((d) => d !== dateStr));
      } else {
        setDraftMultiDates([...draftMultiDates, dateStr].sort());
      }
    } else if (calMode === "single") {
      setDraftSingleDate(dateStr);
    }
  };

  // Apply Calendar Filter
  const applyCalendarFilter = () => {
    if (calMode === "range") {
      if (draftRangeStart) {
        const end = draftRangeEnd || draftRangeStart;
        if (draftRangeStart === end) {
          setActiveDateFilter({ mode: "single", date: draftRangeStart });
        } else {
          setActiveDateFilter({ mode: "range", start: draftRangeStart, end });
        }
      }
    } else if (calMode === "multi") {
      if (draftMultiDates.length === 1) {
        setActiveDateFilter({ mode: "single", date: draftMultiDates[0] });
      } else if (draftMultiDates.length > 1) {
        setActiveDateFilter({ mode: "multi", dates: [...draftMultiDates].sort() });
      }
    } else if (calMode === "single") {
      if (draftSingleDate) {
        setActiveDateFilter({ mode: "single", date: draftSingleDate });
      }
    }
    setCalendarOpen(false);
  };

  // Quick Preset Selection
  const selectPreset = (preset: "today" | "yesterday" | "week" | "month" | "all") => {
    if (preset === "today") {
      setActiveDateFilter({ mode: "today" });
    } else if (preset === "yesterday") {
      setActiveDateFilter({ mode: "yesterday" });
    } else if (preset === "week") {
      setActiveDateFilter({ mode: "week" });
    } else if (preset === "month") {
      setActiveDateFilter({ mode: "month" });
    } else {
      setActiveDateFilter({ mode: "all" });
    }
    setCalendarOpen(false);
  };

  // Filter payments by Bank, Date Filter, Direction, Search
  const filteredPayments = useMemo(() => {
    return allPayments.filter((p) => {
      // 1. Bank Filter
      const isSlice = p.senderId?.includes("SLCBNK") || p.rawMessage?.toLowerCase().includes("slice");
      const isKotak = p.senderId?.includes("KOTAK") || p.rawMessage?.toLowerCase().includes("kotak");
      if (bankFilter === "slice" && !isSlice) return false;
      if (bankFilter === "kotak" && !isKotak) return false;

      // 2. Date Filter
      const pDateStr = toDateStr(new Date(p.timestamp));
      if (activeDateFilter.mode === "today") {
        if (pDateStr !== todayStr) return false;
      } else if (activeDateFilter.mode === "yesterday") {
        if (pDateStr !== yesterdayStr) return false;
      } else if (activeDateFilter.mode === "week") {
        const weekAgo = Date.now() - 7 * 86400000;
        if (p.timestamp < weekAgo) return false;
      } else if (activeDateFilter.mode === "month") {
        const now = new Date();
        const pDate = new Date(p.timestamp);
        if (pDate.getMonth() !== now.getMonth() || pDate.getFullYear() !== now.getFullYear()) {
          return false;
        }
      } else if (activeDateFilter.mode === "single") {
        if (pDateStr !== activeDateFilter.date) return false;
      } else if (activeDateFilter.mode === "range") {
        if (pDateStr < activeDateFilter.start || pDateStr > activeDateFilter.end) return false;
      } else if (activeDateFilter.mode === "multi") {
        if (!activeDateFilter.dates.includes(pDateStr)) return false;
      }

      // 3. Direction Filter
      if (typeFilter === "credit" && p.direction !== "credit") return false;
      if (typeFilter === "debit" && p.direction !== "debit") return false;

      // 4. Search Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = p.payerName.toLowerCase().includes(q);
        const matchesAmount = String(p.amount).includes(q);
        const matchesRef = p.transactionId?.toLowerCase().includes(q);
        return matchesName || matchesAmount || matchesRef;
      }

      return true;
    });
  }, [allPayments, bankFilter, activeDateFilter, todayStr, yesterdayStr, typeFilter, searchQuery]);

  // Dynamic Card Title and Metrics
  const cardMetrics = useMemo(() => {
    const credits = filteredPayments.filter((p) => p.direction === "credit");
    const debits = filteredPayments.filter((p) => p.direction === "debit");
    const totalReceived = credits.reduce((sum, p) => sum + p.amount, 0);
    const totalDebited = debits.reduce((sum, p) => sum + p.amount, 0);
    const netAmount = totalReceived - totalDebited;

    let displayAmount = totalReceived;
    if (typeFilter === "debit") {
      displayAmount = totalDebited;
    }

    let title = typeFilter === "debit" ? "Debit Gaye (Outflow)" : "Aaj Ki Kamai (Received)";
    if (bankFilter === "slice") {
      title = typeFilter === "debit" ? "Slice Debited (Gaye)" : "Slice Bank Kamai (Received)";
    } else if (bankFilter === "kotak") {
      title = typeFilter === "debit" ? "Kotak Debited (Gaye)" : "Kotak 811 Kamai (Received)";
    } else if (activeDateFilter.mode === "yesterday") {
      title = typeFilter === "debit" ? "Kal Ke Debits (Gaye)" : "Kal Ki Kamai (Received)";
    } else if (activeDateFilter.mode === "week") {
      title = typeFilter === "debit" ? "Pichle 7 Din Debits" : "Pichle 7 Din (Received)";
    } else if (activeDateFilter.mode === "month") {
      title = typeFilter === "debit" ? "Is Mahine Ke Debits" : "Is Mahine (Received)";
    } else if (activeDateFilter.mode === "all") {
      title = typeFilter === "debit" ? "Kul Debits (Gaye)" : "Kul Kamai (Total Received)";
    } else if (activeDateFilter.mode === "single") {
      title = `${formatShortDate(activeDateFilter.date)} (${typeFilter === "debit" ? "Debits" : "Received"})`;
    } else if (activeDateFilter.mode === "range") {
      title = `${formatShortDate(activeDateFilter.start)} – ${formatShortDate(activeDateFilter.end)} (${typeFilter === "debit" ? "Debits" : "Received"})`;
    } else if (activeDateFilter.mode === "multi") {
      title = `${activeDateFilter.dates.length} Dates (${typeFilter === "debit" ? "Debits" : "Received"})`;
    }

    return {
      title,
      displayAmount,
      totalReceived,
      totalDebited,
      netAmount,
      creditCount: credits.length,
      debitCount: debits.length,
    };
  }, [filteredPayments, bankFilter, activeDateFilter, typeFilter]);

  // Clean label for the active Date Filter button
  const activeDateLabel = useMemo(() => {
    if (activeDateFilter.mode === "today") return "📅 Aaj (Today)";
    if (activeDateFilter.mode === "yesterday") return "📅 Kal (Yesterday)";
    if (activeDateFilter.mode === "week") return "📅 Pichle 7 Din";
    if (activeDateFilter.mode === "month") return "📅 Is Mahine";
    if (activeDateFilter.mode === "all") return "📅 Sabhi Dates";
    if (activeDateFilter.mode === "single") return `📅 ${formatShortDate(activeDateFilter.date)}`;
    if (activeDateFilter.mode === "range") {
      return `📅 ${formatShortDate(activeDateFilter.start)} – ${formatShortDate(activeDateFilter.end)}`;
    }
    if (activeDateFilter.mode === "multi") {
      return `📅 ${activeDateFilter.dates.length} Dates Chuni Gayi`;
    }
    return "📅 Select Dates";
  }, [activeDateFilter]);

  // Preview stats for Calendar Modal in real-time
  const modalPreview = useMemo(() => {
    let previewCount = 0;
    let previewTotal = 0;

    allPayments.forEach((p) => {
      const pDate = toDateStr(new Date(p.timestamp));
      let matches = false;

      if (calMode === "range" && draftRangeStart) {
        const end = draftRangeEnd || draftRangeStart;
        if (pDate >= draftRangeStart && pDate <= end) matches = true;
      } else if (calMode === "multi") {
        if (draftMultiDates.includes(pDate)) matches = true;
      } else if (calMode === "single" && draftSingleDate) {
        if (pDate === draftSingleDate) matches = true;
      }

      if (matches) {
        previewCount++;
        if (p.direction === "credit") {
          previewTotal += p.amount;
        }
      }
    });

    return { previewCount, previewTotal };
  }, [allPayments, calMode, draftRangeStart, draftRangeEnd, draftMultiDates, draftSingleDate]);

  // Group filtered payments by Date for multi-day views
  const groupedSections = useMemo(() => {
    const groups: {
      [key: string]: {
        dateStr: string;
        items: Payment[];
        creditsTotal: number;
        debitsTotal: number;
      };
    } = {};

    filteredPayments.forEach((p) => {
      const pKey = toDateStr(new Date(p.timestamp));
      const isToday = pKey === todayStr;
      const isYesterday = pKey === yesterdayStr;

      let label = formatShortDate(pKey);
      if (isToday) label = `Aaj · Today (${label})`;
      else if (isYesterday) label = `Kal · Yesterday (${label})`;

      if (!groups[label]) {
        groups[label] = { dateStr: label, items: [], creditsTotal: 0, debitsTotal: 0 };
      }
      groups[label].items.push(p);
      if (p.direction === "credit") {
        groups[label].creditsTotal += p.amount;
      } else if (p.direction === "debit") {
        groups[label].debitsTotal += p.amount;
      }
    });

    return Object.values(groups);
  }, [filteredPayments, todayStr, yesterdayStr]);

  // Calendar Days Grid
  const calendarDays = useMemo(() => {
    const firstDayOfWeek = new Date(calYear, calMonth, 1).getDay(); // 0 = Sunday
    const totalDaysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

    const days: Array<{ day: number | null; dateStr: string | null }> = [];

    // Empty leading padding cells
    for (let i = 0; i < firstDayOfWeek; i++) {
      days.push({ day: null, dateStr: null });
    }

    // Month days
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const y = calYear;
      const m = String(calMonth + 1).padStart(2, "0");
      const dayStr = String(d).padStart(2, "0");
      days.push({ day: d, dateStr: `${y}-${m}-${dayStr}` });
    }

    return days;
  }, [calMonth, calYear]);

  const copyToClipboard = (text: string) => {
    if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedId(text);
      setTimeout(() => setCopiedId(null), 2500);
    }
  };

  const isCustomActive = activeDateFilter.mode !== "today";

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <StatusBar style="light" />

      <View style={styles.outerDesktopWrapper}>
        <View style={styles.phoneFrame}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.storeBadgeRow}>
                <View style={styles.storeIconCircle}>
                  <Text style={styles.storeIconChar}>🏪</Text>
                </View>
                <View>
                  <Text style={styles.storeKicker}>PAPA'S STORE · BHAAJI BHANDAR</Text>
                  <View style={styles.liveSyncRow}>
                    <View style={styles.pulsingDot} />
                    <Text style={styles.liveSyncText}>
                      {data?.sourceStatus === "google-messages"
                        ? "Google Messages Synced"
                        : "Demo Mode"}
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={styles.headerActions}>
              <Pressable
                style={[styles.headerActionBtn, soundEnabled && styles.soundBtnActive]}
                onPress={() => {
                  const next = !soundEnabled;
                  setSoundEnabled(next);
                  if (next) speakAnnouncement(100, "Test");
                }}
                accessibilityLabel="Soundbox toggle"
              >
                <Text style={styles.headerActionIcon}>{soundEnabled ? "🔊" : "🔇"}</Text>
              </Pressable>

              <Pressable
                style={styles.headerActionBtn}
                onPress={() => {
                  setCustomUrlInput(apiBase);
                  setTestResult(null);
                  setSettingsOpen(true);
                }}
                accessibilityLabel="Settings"
              >
                <Text style={styles.headerActionIcon}>⚙️</Text>
              </Pressable>
            </View>
          </View>

          {/* New Payment Alert Banner */}
          {newAlert && (
            <View style={styles.newPaymentBanner}>
              <Text style={styles.newPaymentBannerText}>{newAlert}</Text>
            </View>
          )}

          {/* Clean Uncluttered Filter Bar (Single Row) */}
          <View style={styles.cleanFilterBar}>
            {/* Primary Date Range / Multi-Date Picker Button */}
            <Pressable
              style={styles.datePickerTriggerBtn}
              onPress={openCalendar}
            >
              <Text style={styles.datePickerTriggerText} numberOfLines={1}>
                {activeDateLabel}
              </Text>
              <Text style={styles.datePickerArrow}>▼</Text>
            </Pressable>

            {/* Quick Reset to Today Button (if not on today) */}
            {isCustomActive && (
              <Pressable
                style={styles.resetTodayBtn}
                onPress={() => selectPreset("today")}
              >
                <Text style={styles.resetTodayBtnText}>✕ Aaj</Text>
              </Pressable>
            )}

            {/* Bank Selector Button */}
            <View style={styles.bankSelectRow}>
              <Pressable
                style={[
                  styles.bankTabMini,
                  bankFilter === "all" && styles.bankTabMiniActive,
                ]}
                onPress={() => setBankFilter("all")}
              >
                <Text
                  style={[
                    styles.bankTabMiniText,
                    bankFilter === "all" && styles.bankTabMiniTextActive,
                  ]}
                >
                  All
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.bankTabMini,
                  bankFilter === "slice" && styles.bankTabSliceActive,
                ]}
                onPress={() => setBankFilter("slice")}
              >
                <Text
                  style={[
                    styles.bankTabMiniText,
                    bankFilter === "slice" && styles.bankTabSliceTextActive,
                  ]}
                >
                  💜 Slice
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.bankTabMini,
                  bankFilter === "kotak" && styles.bankTabKotakActive,
                ]}
                onPress={() => setBankFilter("kotak")}
              >
                <Text
                  style={[
                    styles.bankTabMiniText,
                    bankFilter === "kotak" && styles.bankTabKotakTextActive,
                  ]}
                >
                  🔴 Kotak
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Hero Earnings Card */}
          <View style={styles.heroEarningsCard}>
            <View style={styles.heroCardHeaderRow}>
              <Text style={styles.heroCardTitle}>{cardMetrics.title}</Text>
              <View style={styles.dbPill}>
                <Text style={styles.dbPillText}>{data?.dbType || "PostgreSQL (Cloud)"}</Text>
              </View>
            </View>

            <View style={styles.amountDisplayRow}>
              <Text style={styles.heroRupeeSymbol}>₹</Text>
              <Text style={styles.heroMainAmount}>
                {money(cardMetrics.displayAmount).replace("₹", "")}
              </Text>
            </View>

            <View style={styles.heroMetricsRow}>
              <View style={styles.metricChip}>
                <View style={styles.greenMetricDot} />
                <Text style={styles.metricChipText}>
                  +{money(cardMetrics.totalReceived)} Aaye ({cardMetrics.creditCount})
                </Text>
              </View>

              {cardMetrics.debitCount > 0 && (
                <View style={[styles.metricChip, styles.debitMetricChip]}>
                  <View style={styles.orangeMetricDot} />
                  <Text style={styles.metricChipText}>
                    -{money(cardMetrics.totalDebited)} Gaye ({cardMetrics.debitCount})
                  </Text>
                </View>
              )}
            </View>

            {/* Net Balance Row if Debits exist and showing Sabhi */}
            {cardMetrics.debitCount > 0 && typeFilter === "all" && (
              <View style={styles.netBalanceRow}>
                <Text style={styles.netBalanceLabel}>Net Bacha (Aaye - Gaye):</Text>
                <Text style={styles.netBalanceValue}>{money(cardMetrics.netAmount)}</Text>
              </View>
            )}

            {/* Prompt if Today is 0 */}
            {activeDateFilter.mode === "today" && cardMetrics.displayAmount === 0 && (
              <Pressable
                style={styles.switchDateNotice}
                onPress={() => selectPreset("all")}
              >
                <Text style={styles.switchDateNoticeText}>
                  👉 Aaj abhi tak koi payment receive nahi hui (₹0). Pichli sabhi payments dekhne ke liye yahan tap karein.
                </Text>
              </Pressable>
            )}
          </View>

          {/* Primary Refresh Action Button */}
          <Pressable
            style={({ pressed }) => [
              styles.primaryRefreshBtn,
              pressed && styles.primaryRefreshBtnPressed,
              loading && styles.primaryRefreshBtnDisabled,
            ]}
            onPress={() => fetchPayments()}
            disabled={loading}
          >
            {loading ? (
              <View style={styles.btnContentRow}>
                <ActivityIndicator color="#FFFFFF" size="small" />
                <Text style={styles.primaryRefreshBtnText}>
                  Scanning Google Messages Live...
                </Text>
              </View>
            ) : (
              <View style={styles.btnContentRow}>
                <Text style={styles.btnIcon}>🔄</Text>
                <Text style={styles.primaryRefreshBtnText}>
                  Refresh Payments Now
                </Text>
              </View>
            )}
          </Pressable>

          {/* Error Banner */}
          {error ? (
            <View style={styles.errorAlertContainer}>
              <Text style={styles.errorAlertIcon}>⚠️</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.errorAlertTitle}>Connection Error</Text>
                <Text style={styles.errorAlertText}>{error}</Text>
                <Pressable
                  style={styles.errorAlertBtn}
                  onPress={() => setSettingsOpen(true)}
                >
                  <Text style={styles.errorAlertBtnText}>Fix API Settings (⚙️)</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {/* Type Filter & Search */}
          <View style={styles.subFilterRow}>
            <View style={styles.typeSegmentTabs}>
              <Pressable
                style={[
                  styles.segmentBtn,
                  typeFilter === "all" && styles.segmentBtnActive,
                ]}
                onPress={() => setTypeFilter("all")}
              >
                <Text
                  style={[
                    styles.segmentBtnText,
                    typeFilter === "all" && styles.segmentBtnTextActive,
                  ]}
                >
                  Sabhi ({filteredPayments.length})
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.segmentBtn,
                  typeFilter === "credit" && styles.segmentBtnActive,
                ]}
                onPress={() => setTypeFilter("credit")}
              >
                <Text
                  style={[
                    styles.segmentBtnText,
                    typeFilter === "credit" && styles.segmentBtnTextActive,
                  ]}
                >
                  ↓ Aaye
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.segmentBtn,
                  typeFilter === "debit" && styles.segmentBtnActive,
                ]}
                onPress={() => setTypeFilter("debit")}
              >
                <Text
                  style={[
                    styles.segmentBtnText,
                    typeFilter === "debit" && styles.segmentBtnTextActive,
                  ]}
                >
                  ↗ Gaye
                </Text>
              </Pressable>
            </View>

            {filteredPayments.length > 2 && (
              <View style={styles.searchBarBox}>
                <Text style={styles.searchIcon}>🔍</Text>
                <TextInput
                  style={styles.searchFieldInput}
                  placeholder="Grahak, bank ya UPI ref khojein..."
                  placeholderTextColor="#94A3B8"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                {searchQuery.length > 0 && (
                  <Pressable onPress={() => setSearchQuery("")}>
                    <Text style={styles.clearSearchBtn}>✕</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>

          {/* Transactions List */}
          <ScrollView
            style={styles.transactionsScroll}
            contentContainerStyle={styles.transactionsScrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={loading} onRefresh={() => fetchPayments()} />
            }
          >
            {groupedSections.length === 0 ? (
              <View style={styles.emptyViewBox}>
                <Text style={styles.emptyViewEmoji}>📋</Text>
                <Text style={styles.emptyViewTitle}>
                  {activeDateFilter.mode === "today"
                    ? "Aaj abhi tak koi payment nahi aayi"
                    : "Is selected filter me koi payment nahi mili"}
                </Text>
                <Text style={styles.emptyViewDesc}>
                  {activeDateFilter.mode === "today"
                    ? "Jaise hi customer UPI karega aur SMS aayega, Refresh dabate hi yahan dikhega."
                    : "Calendar se date badal kar dekhein ya 'Sabhi Dates' chunein."}
                </Text>
                <Pressable
                  style={styles.emptyActionBtn}
                  onPress={() => selectPreset("all")}
                >
                  <Text style={styles.emptyActionBtnText}>
                    Sabhi Purani Payments Dekhein
                  </Text>
                </Pressable>
              </View>
            ) : (
              groupedSections.map((section) => (
                <View key={section.dateStr} style={styles.dateGroupContainer}>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionDateTitle}>{section.dateStr}</Text>
                    <View style={styles.sectionAmountsRow}>
                      {section.creditsTotal > 0 && (
                        <Text style={styles.sectionSubtotalText}>
                          +{money(section.creditsTotal)}
                        </Text>
                      )}
                      {section.debitsTotal > 0 && (
                        <Text style={styles.sectionDebitsSubtotalText}>
                          -{money(section.debitsTotal)}
                        </Text>
                      )}
                    </View>
                  </View>

                  {section.items.map((item) => {
                    const isCredit = item.direction === "credit";
                    const initial = (item.payerName || "C").charAt(0).toUpperCase();
                    const isSlice =
                      item.senderId?.includes("SLCBNK") ||
                      item.rawMessage?.toLowerCase().includes("slice");
                    const bankLabel = isSlice ? "Slice UPI" : "Kotak 811";

                    return (
                      <Pressable
                        key={item.id}
                        style={({ pressed }) => [
                          styles.fintechCard,
                          pressed && styles.fintechCardPressed,
                        ]}
                        onPress={() => setSelectedPayment(item)}
                      >
                        <View
                          style={[
                            styles.avatarBadge,
                            isCredit ? styles.avatarCredit : styles.avatarDebit,
                          ]}
                        >
                          <Text
                            style={[
                              styles.avatarInitial,
                              isCredit ? styles.avatarInitialCredit : styles.avatarInitialDebit,
                            ]}
                          >
                            {initial}
                          </Text>
                        </View>

                        <View style={styles.cardCenterCol}>
                          <Text style={styles.customerName} numberOfLines={1}>
                            {item.payerName}
                          </Text>
                          <View style={styles.cardMetaRow}>
                            <View
                              style={[
                                styles.bankTagBadge,
                                isSlice ? styles.bankTagSlice : styles.bankTagKotak,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.bankTagText,
                                  isSlice ? styles.bankTagTextSlice : styles.bankTagTextKotak,
                                ]}
                              >
                                {bankLabel}
                              </Text>
                            </View>

                            {item.transactionId && (
                              <Pressable
                                onPress={() => copyToClipboard(item.transactionId!)}
                                style={styles.upiRefPill}
                              >
                                <Text style={styles.upiRefText}>
                                  {copiedId === item.transactionId
                                    ? "✓ Copied!"
                                    : `UPI: ${item.transactionId.slice(-6)}`}
                                </Text>
                              </Pressable>
                            )}
                          </View>
                        </View>

                        <View style={styles.cardRightCol}>
                          <Text
                            style={[
                              styles.cardAmountText,
                              isCredit ? styles.amountCredit : styles.amountDebit,
                            ]}
                          >
                            {isCredit ? "+" : "-"}
                            {money(item.amount)}
                          </Text>
                          <View
                            style={[
                              styles.statusBadge,
                              isCredit ? styles.statusBadgeCredit : styles.statusBadgeDebit,
                            ]}
                          >
                            <Text
                              style={[
                                styles.statusBadgeText,
                                isCredit ? styles.statusTextCredit : styles.statusTextDebit,
                              ]}
                            >
                              {isCredit ? "✓ RECEIVED" : "↗ DEBIT"}
                            </Text>
                          </View>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ))
            )}
          </ScrollView>

          {/* Footer Bar */}
          <View style={styles.fintechFooter}>
            <Text style={styles.footerSyncText}>
              {data?.lastRefreshedAt
                ? `Last sync: ${new Date(data.lastRefreshedAt).toLocaleTimeString("en-IN")}`
                : "Pull to refresh"}
              {" · "}{data?.dbType || "Permanent Database"}
            </Text>
          </View>
        </View>
      </View>

      {/* Advanced Interactive Calendar & Date Range / Multi-Date Picker Modal */}
      <Modal
        visible={calendarOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCalendarOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.calendarModalBox}>
            {/* Modal Header */}
            <View style={styles.calendarModalHeader}>
              <View>
                <Text style={styles.calendarModalTitle}>📅 Taareekh Chunein (Date Filter)</Text>
                <Text style={styles.calendarModalSubtitle}>
                  Range, multiple dates ya single date chun kar filter karein
                </Text>
              </View>
              <Pressable
                onPress={() => setCalendarOpen(false)}
                style={styles.closeModalBtn}
              >
                <Text style={styles.closeModalText}>✕</Text>
              </Pressable>
            </View>

            {/* Mode Selection Tabs (Range vs Multi-Date vs Single Date) */}
            <View style={styles.calModeSelectorRow}>
              <Pressable
                style={[
                  styles.calModeTabBtn,
                  calMode === "range" && styles.calModeTabBtnActive,
                ]}
                onPress={() => setCalMode("range")}
              >
                <Text
                  style={[
                    styles.calModeTabBtnText,
                    calMode === "range" && styles.calModeTabBtnTextActive,
                  ]}
                >
                  ↔️ Range (From - To)
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.calModeTabBtn,
                  calMode === "multi" && styles.calModeTabBtnActive,
                ]}
                onPress={() => setCalMode("multi")}
              >
                <Text
                  style={[
                    styles.calModeTabBtnText,
                    calMode === "multi" && styles.calModeTabBtnTextActive,
                  ]}
                >
                  🗓️ Multi-Dates
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.calModeTabBtn,
                  calMode === "single" && styles.calModeTabBtnActive,
                ]}
                onPress={() => setCalMode("single")}
              >
                <Text
                  style={[
                    styles.calModeTabBtnText,
                    calMode === "single" && styles.calModeTabBtnTextActive,
                  ]}
                >
                  📌 Single Date
                </Text>
              </Pressable>
            </View>

            {/* Quick Presets Row */}
            <View style={styles.calendarPresetsRow}>
              <Pressable
                style={styles.calPresetBtn}
                onPress={() => selectPreset("today")}
              >
                <Text style={styles.calPresetBtnText}>Aaj</Text>
              </Pressable>
              <Pressable
                style={styles.calPresetBtn}
                onPress={() => selectPreset("yesterday")}
              >
                <Text style={styles.calPresetBtnText}>Kal</Text>
              </Pressable>
              <Pressable
                style={styles.calPresetBtn}
                onPress={() => selectPreset("week")}
              >
                <Text style={styles.calPresetBtnText}>7 Din</Text>
              </Pressable>
              <Pressable
                style={styles.calPresetBtn}
                onPress={() => selectPreset("month")}
              >
                <Text style={styles.calPresetBtnText}>Is Mahine</Text>
              </Pressable>
              <Pressable
                style={styles.calPresetBtn}
                onPress={() => selectPreset("all")}
              >
                <Text style={styles.calPresetBtnText}>Sabhi</Text>
              </Pressable>
            </View>

            {/* Month & Year Navigation Header */}
            <View style={styles.monthNavRow}>
              <Pressable
                style={styles.monthNavArrowBtn}
                onPress={() => {
                  if (calMonth === 0) {
                    setCalMonth(11);
                    setCalYear(calYear - 1);
                  } else {
                    setCalMonth(calMonth - 1);
                  }
                }}
              >
                <Text style={styles.monthNavArrowText}>◀</Text>
              </Pressable>

              <Text style={styles.monthNavTitle}>
                {MONTH_NAMES[calMonth]} {calYear}
              </Text>

              <Pressable
                style={styles.monthNavArrowBtn}
                onPress={() => {
                  if (calMonth === 11) {
                    setCalMonth(0);
                    setCalYear(calYear + 1);
                  } else {
                    setCalMonth(calMonth + 1);
                  }
                }}
              >
                <Text style={styles.monthNavArrowText}>▶</Text>
              </Pressable>
            </View>

            {/* Weekday Letters */}
            <View style={styles.weekLettersRow}>
              {DAY_LETTERS.map((letter, idx) => (
                <Text key={idx} style={styles.weekLetterText}>
                  {letter}
                </Text>
              ))}
            </View>

            {/* Calendar Days Grid */}
            <View style={styles.daysGrid}>
              {calendarDays.map((item, idx) => {
                if (!item.day || !item.dateStr) {
                  return <View key={idx} style={styles.dayCellEmpty} />;
                }

                const dStr = item.dateStr;
                const hasTransactions = datesWithTransactions.has(dStr);
                const isToday = dStr === todayStr;

                let isSelected = false;
                let isInRange = false;

                if (calMode === "range") {
                  const isStart = draftRangeStart === dStr;
                  const isEnd = draftRangeEnd === dStr;
                  isSelected = isStart || isEnd;
                  if (draftRangeStart && draftRangeEnd && dStr >= draftRangeStart && dStr <= draftRangeEnd) {
                    isInRange = true;
                  }
                } else if (calMode === "multi") {
                  isSelected = draftMultiDates.includes(dStr);
                } else if (calMode === "single") {
                  isSelected = draftSingleDate === dStr;
                }

                return (
                  <Pressable
                    key={idx}
                    style={[
                      styles.dayCell,
                      isInRange && styles.dayCellInRange,
                      isSelected && styles.dayCellActive,
                    ]}
                    onPress={() => handleCalendarDayClick(dStr)}
                  >
                    <Text
                      style={[
                        styles.dayCellNumber,
                        isSelected && styles.dayCellNumberActive,
                        isToday && !isSelected && styles.dayCellNumberToday,
                      ]}
                    >
                      {item.day}
                    </Text>
                    {hasTransactions && (
                      <View
                        style={[
                          styles.txDot,
                          isSelected && styles.txDotActive,
                        ]}
                      />
                    )}
                  </Pressable>
                );
              })}
            </View>

            {/* Live Selection Status & Calculation Strip */}
            <View style={styles.calSelectionStatusRow}>
              <View style={styles.selectionInfoCol}>
                <Text style={styles.calSelectionStatusText}>
                  {calMode === "range" && (
                    draftRangeStart && draftRangeEnd
                      ? `Range: ${formatShortDate(draftRangeStart)} – ${formatShortDate(draftRangeEnd)}`
                      : draftRangeStart
                      ? `Start: ${formatShortDate(draftRangeStart)} (Ab End Date chunein)`
                      : "Start Date aur End Date par tap karein"
                  )}
                  {calMode === "multi" && (
                    draftMultiDates.length > 0
                      ? `${draftMultiDates.length} Dates selected: ${draftMultiDates.map((d) => formatShortDate(d)).join(", ")}`
                      : "Jo jo dates dekhni hain unpar tap karein"
                  )}
                  {calMode === "single" && (
                    draftSingleDate
                      ? `Selected Date: ${formatShortDate(draftSingleDate)}`
                      : "Kisi ek date par tap karein"
                  )}
                </Text>
                {modalPreview.previewCount > 0 && (
                  <Text style={styles.previewCalcText}>
                    ✨ {modalPreview.previewCount} transactions · Total received: {money(modalPreview.previewTotal)}
                  </Text>
                )}
              </View>
            </View>

            {/* Apply & Cancel Actions */}
            <View style={styles.calModalActionsRow}>
              <Pressable
                style={styles.calResetBtn}
                onPress={() => selectPreset("all")}
              >
                <Text style={styles.calResetBtnText}>Sabhi (Reset)</Text>
              </Pressable>

              <Pressable
                style={styles.calCancelBtn}
                onPress={() => setCalendarOpen(false)}
              >
                <Text style={styles.calCancelBtnText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={styles.calApplyBtn}
                onPress={applyCalendarFilter}
              >
                <Text style={styles.calApplyBtnText}>✓ Lagayein (Apply)</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Payment Receipt Modal */}
      <Modal
        visible={!!selectedPayment}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedPayment(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.receiptCard}>
            <View style={styles.receiptTopBorder} />
            <View style={styles.receiptHeader}>
              <View>
                <Text style={styles.receiptCompany}>PAPA'S STORE · RECEIPT</Text>
                <Text style={styles.receiptDate}>
                  {selectedPayment &&
                    new Date(selectedPayment.timestamp).toLocaleString("hi-IN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                </Text>
              </View>
              <Pressable
                onPress={() => setSelectedPayment(null)}
                style={styles.closeModalBtn}
              >
                <Text style={styles.closeModalText}>✕</Text>
              </Pressable>
            </View>

            {selectedPayment && (
              <View style={styles.receiptBody}>
                <View style={styles.receiptAmountHero}>
                  <Text
                    style={[
                      styles.receiptBigAmount,
                      selectedPayment.direction === "credit"
                        ? styles.amountCredit
                        : styles.amountDebit,
                    ]}
                  >
                    {selectedPayment.direction === "credit" ? "+" : "-"}
                    {money(selectedPayment.amount)}
                  </Text>
                  <View
                    style={[
                      styles.statusBadge,
                      selectedPayment.direction === "credit"
                        ? styles.statusBadgeCredit
                        : styles.statusBadgeDebit,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        selectedPayment.direction === "credit"
                          ? styles.statusTextCredit
                          : styles.statusTextDebit,
                      ]}
                    >
                      {selectedPayment.direction === "credit"
                        ? "PAYMENT RECEIVED"
                        : "DEBIT TRANSACTION"}
                    </Text>
                  </View>
                </View>

                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Customer / Grahak:</Text>
                  <Text style={styles.receiptValue}>{selectedPayment.payerName}</Text>
                </View>

                {selectedPayment.transactionId && (
                  <View style={styles.receiptRow}>
                    <Text style={styles.receiptLabel}>UPI Reference No:</Text>
                    <Pressable
                      onPress={() => copyToClipboard(selectedPayment.transactionId!)}
                    >
                      <Text style={[styles.receiptValue, styles.monoHighlight]}>
                        {selectedPayment.transactionId} 📋
                      </Text>
                    </Pressable>
                  </View>
                )}

                <View style={styles.receiptRow}>
                  <Text style={styles.receiptLabel}>Bank Sender:</Text>
                  <Text style={styles.receiptValue}>{selectedPayment.senderId}</Text>
                </View>

                {selectedPayment.rawMessage && (
                  <View style={styles.originalSmsCard}>
                    <Text style={styles.originalSmsHeading}>Original Bank SMS:</Text>
                    <Text style={styles.originalSmsContent}>
                      {selectedPayment.rawMessage}
                    </Text>
                  </View>
                )}

                <Pressable
                  style={styles.speakReceiptBtn}
                  onPress={() =>
                    speakAnnouncement(
                      selectedPayment.amount,
                      selectedPayment.payerName
                    )
                  }
                >
                  <Text style={styles.speakReceiptBtnText}>
                    🔊 Soundbox Me Bol Kar Sunao
                  </Text>
                </Pressable>

                <Pressable
                  style={styles.closeReceiptBtn}
                  onPress={() => setSelectedPayment(null)}
                >
                  <Text style={styles.closeReceiptBtnText}>Band Karein (Close)</Text>
                </Pressable>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Settings Modal */}
      <Modal
        visible={settingsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSettingsOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.settingsBox}>
            <View style={styles.settingsHeader}>
              <Text style={styles.settingsModalTitle}>API Server Settings</Text>
              <Pressable onPress={() => setSettingsOpen(false)}>
                <Text style={styles.closeModalText}>✕</Text>
              </Pressable>
            </View>

            <Text style={styles.settingsFieldLabel}>Backend Server URL:</Text>
            <TextInput
              style={styles.settingsInputField}
              value={customUrlInput}
              onChangeText={setCustomUrlInput}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="e.g. http://localhost:4000"
            />

            <View style={styles.presetButtonsRow}>
              <Pressable
                style={styles.presetButton}
                onPress={() => setCustomUrlInput("http://localhost:4000")}
              >
                <Text style={styles.presetButtonText}>PC Localhost</Text>
              </Pressable>
              <Pressable
                style={styles.presetButton}
                onPress={() => setCustomUrlInput("http://10.20.10.84:4000")}
              >
                <Text style={styles.presetButtonText}>Phone Wi-Fi (10.20.10.84)</Text>
              </Pressable>
            </View>

            <Pressable
              style={styles.testConnectionButton}
              onPress={() => testConnection(customUrlInput)}
              disabled={testingConnection}
            >
              {testingConnection ? (
                <ActivityIndicator color="#0F172A" size="small" />
              ) : (
                <Text style={styles.testConnectionButtonText}>Test Connection</Text>
              )}
            </Pressable>

            {testResult && (
              <View
                style={[
                  styles.testResultBanner,
                  testResult.startsWith("success")
                    ? styles.testResultBannerSuccess
                    : styles.testResultBannerError,
                ]}
              >
                <Text
                  style={
                    testResult.startsWith("success")
                      ? styles.testResultTextSuccess
                      : styles.testResultTextError
                  }
                >
                  {testResult.replace(/^(success|error):/, "")}
                </Text>
              </View>
            )}

            <Pressable
              style={styles.saveSettingsButton}
              onPress={handleSaveSettings}
            >
              <Text style={styles.saveSettingsButtonText}>Save & Reconnect</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <MainTracker />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0B132B",
  },
  outerDesktopWrapper: {
    flex: 1,
    backgroundColor: "#0F172A",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  phoneFrame: {
    flex: 1,
    width: "100%",
    maxWidth: 480,
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    paddingTop: 4,
  },
  headerLeft: {
    flex: 1,
  },
  storeBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  storeIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  storeIconChar: {
    fontSize: 16,
  },
  storeKicker: {
    color: "#0F172A",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  liveSyncRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  pulsingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#10B981",
    marginRight: 5,
  },
  liveSyncText: {
    color: "#059669",
    fontSize: 10,
    fontWeight: "700",
  },
  headerActions: {
    flexDirection: "row",
    gap: 6,
  },
  headerActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  soundBtnActive: {
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
  },
  headerActionIcon: {
    fontSize: 15,
  },
  newPaymentBanner: {
    backgroundColor: "#059669",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 8,
    alignItems: "center",
  },
  newPaymentBannerText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  // Clean Uncluttered Filter Bar
  cleanFilterBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    marginBottom: 10,
  },
  datePickerTriggerBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  datePickerTriggerText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#0F172A",
    flexShrink: 1,
  },
  datePickerArrow: {
    fontSize: 10,
    color: "#64748B",
    marginLeft: 4,
  },
  resetTodayBtn: {
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 7,
  },
  resetTodayBtnText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#475569",
  },
  bankSelectRow: {
    flexDirection: "row",
    gap: 3,
    backgroundColor: "#E2E8F0",
    borderRadius: 10,
    padding: 3,
  },
  bankTabMini: {
    paddingHorizontal: 7,
    paddingVertical: 6,
    borderRadius: 7,
  },
  bankTabMiniActive: {
    backgroundColor: "#0F172A",
  },
  bankTabSliceActive: {
    backgroundColor: "#6D28D9",
  },
  bankTabKotakActive: {
    backgroundColor: "#B91C1C",
  },
  bankTabMiniText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#475569",
  },
  bankTabMiniTextActive: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  bankTabSliceTextActive: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  bankTabKotakTextActive: {
    color: "#FFFFFF",
    fontWeight: "800",
  },
  // Hero Earnings Card
  heroEarningsCard: {
    backgroundColor: "#064E3B",
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    shadowColor: "#064E3B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  heroCardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  heroCardTitle: {
    color: "#A7F3D0",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  dbPill: {
    backgroundColor: "rgba(255, 255, 255, 0.15)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  dbPillText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "700",
  },
  amountDisplayRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginVertical: 2,
  },
  heroRupeeSymbol: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "800",
    marginRight: 4,
  },
  heroMainAmount: {
    color: "#FFFFFF",
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  heroMetricsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  metricChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.14)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 6,
  },
  debitMetricChip: {
    backgroundColor: "rgba(254, 215, 170, 0.2)",
  },
  greenMetricDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#34D399",
  },
  orangeMetricDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#FB923C",
  },
  metricChipText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  netBalanceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.15)",
  },
  netBalanceLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#A7F3D0",
  },
  netBalanceValue: {
    fontSize: 12,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  switchDateNotice: {
    marginTop: 10,
    backgroundColor: "rgba(0, 0, 0, 0.2)",
    padding: 8,
    borderRadius: 8,
  },
  switchDateNoticeText: {
    color: "#FDE68A",
    fontSize: 10,
    fontWeight: "700",
    lineHeight: 14,
  },
  // Primary Refresh Action Button
  primaryRefreshBtn: {
    backgroundColor: "#0F172A",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
    elevation: 2,
  },
  primaryRefreshBtnPressed: {
    opacity: 0.88,
  },
  primaryRefreshBtnDisabled: {
    opacity: 0.7,
  },
  btnContentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  btnIcon: {
    fontSize: 15,
  },
  primaryRefreshBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  errorAlertContainer: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    flexDirection: "row",
    gap: 8,
  },
  errorAlertIcon: {
    fontSize: 18,
  },
  errorAlertTitle: {
    color: "#991B1B",
    fontSize: 12,
    fontWeight: "800",
  },
  errorAlertText: {
    color: "#B91C1C",
    fontSize: 11,
    marginTop: 2,
  },
  errorAlertBtn: {
    marginTop: 4,
    backgroundColor: "#EF4444",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    alignSelf: "flex-start",
  },
  errorAlertBtnText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
  },
  // Sub Filters & Search
  subFilterRow: {
    marginBottom: 8,
  },
  typeSegmentTabs: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 6,
  },
  segmentBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
    backgroundColor: "#E2E8F0",
  },
  segmentBtnActive: {
    backgroundColor: "#0F172A",
  },
  segmentBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
  },
  segmentBtnTextActive: {
    color: "#FFFFFF",
  },
  searchBarBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  searchIcon: {
    fontSize: 12,
    marginRight: 6,
    color: "#64748B",
  },
  searchFieldInput: {
    flex: 1,
    fontSize: 11,
    color: "#0F172A",
    padding: 0,
  },
  clearSearchBtn: {
    fontSize: 12,
    color: "#94A3B8",
    paddingHorizontal: 4,
    fontWeight: "700",
  },
  // Transactions Scroll
  transactionsScroll: {
    flex: 1,
  },
  transactionsScrollContent: {
    paddingBottom: 20,
  },
  dateGroupContainer: {
    marginBottom: 12,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 2,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  sectionDateTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#334155",
  },
  sectionSubtotalText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#047857",
  },
  sectionAmountsRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  sectionDebitsSubtotalText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#DC2626",
  },
  // Fintech Card
  fintechCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  fintechCardPressed: {
    backgroundColor: "#F1F5F9",
  },
  avatarBadge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  avatarCredit: {
    backgroundColor: "#ECFDF5",
  },
  avatarDebit: {
    backgroundColor: "#FEF2F2",
  },
  avatarInitial: {
    fontSize: 15,
    fontWeight: "900",
  },
  avatarInitialCredit: {
    color: "#059669",
  },
  avatarInitialDebit: {
    color: "#DC2626",
  },
  cardCenterCol: {
    flex: 1,
    marginRight: 8,
  },
  customerName: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 4,
  },
  cardMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  bankTagBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  bankTagSlice: {
    backgroundColor: "#F3E8FF",
  },
  bankTagKotak: {
    backgroundColor: "#FEE2E2",
  },
  bankTagText: {
    fontSize: 9,
    fontWeight: "800",
  },
  bankTagTextSlice: {
    color: "#7E22CE",
  },
  bankTagTextKotak: {
    color: "#B91C1C",
  },
  upiRefPill: {
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  upiRefText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#475569",
  },
  cardRightCol: {
    alignItems: "flex-end",
  },
  cardAmountText: {
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 3,
  },
  amountCredit: {
    color: "#059669",
  },
  amountDebit: {
    color: "#DC2626",
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: "#ECFDF5",
  },
  statusBadgeCredit: {
    backgroundColor: "#ECFDF5",
  },
  statusBadgeDebit: {
    backgroundColor: "#FEF2F2",
  },
  statusBadgeText: {
    fontSize: 8,
    fontWeight: "900",
  },
  statusTextCredit: {
    color: "#047857",
  },
  statusTextDebit: {
    color: "#B91C1C",
  },
  // Empty State
  emptyViewBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 36,
    paddingHorizontal: 18,
  },
  emptyViewEmoji: {
    fontSize: 40,
    marginBottom: 6,
  },
  emptyViewTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#1E293B",
    textAlign: "center",
  },
  emptyViewDesc: {
    fontSize: 11,
    color: "#64748B",
    textAlign: "center",
    marginTop: 4,
    lineHeight: 16,
  },
  emptyActionBtn: {
    marginTop: 12,
    backgroundColor: "#0F172A",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 7,
  },
  emptyActionBtnText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "700",
  },
  fintechFooter: {
    paddingVertical: 6,
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
  },
  footerSyncText: {
    fontSize: 10,
    color: "#94A3B8",
    fontWeight: "600",
  },
  // Calendar Modal Box
  calendarModalBox: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  calendarModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    paddingBottom: 8,
  },
  calendarModalTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: "#0F172A",
  },
  calendarModalSubtitle: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 1,
  },
  // Calendar Mode Tabs
  calModeSelectorRow: {
    flexDirection: "row",
    backgroundColor: "#E2E8F0",
    borderRadius: 9,
    padding: 3,
    marginBottom: 10,
    gap: 4,
  },
  calModeTabBtn: {
    flex: 1,
    paddingVertical: 6,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  calModeTabBtnActive: {
    backgroundColor: "#059669",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  calModeTabBtnText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#475569",
  },
  calModeTabBtnTextActive: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  calendarPresetsRow: {
    flexDirection: "row",
    gap: 4,
    marginBottom: 10,
    backgroundColor: "#F1F5F9",
    borderRadius: 8,
    padding: 3,
  },
  calPresetBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    backgroundColor: "#FFFFFF",
  },
  calPresetBtnText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#334155",
  },
  monthNavRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  monthNavArrowBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  monthNavArrowText: {
    fontSize: 12,
    color: "#0F172A",
    fontWeight: "800",
  },
  monthNavTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
  },
  weekLettersRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginBottom: 4,
  },
  weekLetterText: {
    width: 40,
    textAlign: "center",
    fontSize: 11,
    fontWeight: "800",
    color: "#94A3B8",
  },
  daysGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
  },
  dayCellEmpty: {
    width: "14.28%",
    height: 40,
  },
  dayCell: {
    width: "14.28%",
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    marginVertical: 1,
  },
  dayCellInRange: {
    backgroundColor: "#D1FAE5",
    borderRadius: 0,
  },
  dayCellActive: {
    backgroundColor: "#059669",
    borderRadius: 8,
  },
  dayCellNumber: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1E293B",
  },
  dayCellNumberActive: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  dayCellNumberToday: {
    color: "#059669",
    fontWeight: "900",
  },
  txDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#10B981",
    marginTop: 2,
  },
  txDotActive: {
    backgroundColor: "#FFFFFF",
  },
  calSelectionStatusRow: {
    marginTop: 10,
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: "#F8FAFC",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  selectionInfoCol: {
    gap: 3,
  },
  calSelectionStatusText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#334155",
    textAlign: "center",
  },
  previewCalcText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#059669",
    textAlign: "center",
  },
  calModalActionsRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 12,
  },
  calResetBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  calResetBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
  },
  calCancelBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    backgroundColor: "#F1F5F9",
  },
  calCancelBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748B",
  },
  calApplyBtn: {
    flex: 2,
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9,
    backgroundColor: "#059669",
  },
  calApplyBtnText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  // Modal Backdrop
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  receiptCard: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    overflow: "hidden",
  },
  receiptTopBorder: {
    height: 4,
    backgroundColor: "#059669",
  },
  receiptHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  receiptCompany: {
    fontSize: 10,
    fontWeight: "900",
    color: "#64748B",
  },
  receiptDate: {
    fontSize: 11,
    color: "#0F172A",
    fontWeight: "700",
    marginTop: 2,
  },
  closeModalBtn: {
    padding: 4,
  },
  closeModalText: {
    fontSize: 16,
    color: "#94A3B8",
    fontWeight: "700",
  },
  receiptBody: {
    padding: 14,
  },
  receiptAmountHero: {
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    marginBottom: 10,
  },
  receiptBigAmount: {
    fontSize: 30,
    fontWeight: "900",
  },
  receiptRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  receiptLabel: {
    fontSize: 11,
    color: "#64748B",
    fontWeight: "600",
  },
  receiptValue: {
    fontSize: 12,
    color: "#0F172A",
    fontWeight: "800",
  },
  monoHighlight: {
    color: "#2563EB",
  },
  originalSmsCard: {
    backgroundColor: "#F8FAFC",
    borderRadius: 7,
    padding: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  originalSmsHeading: {
    fontSize: 9,
    fontWeight: "800",
    color: "#64748B",
    marginBottom: 3,
    textTransform: "uppercase",
  },
  originalSmsContent: {
    fontSize: 10,
    color: "#1E293B",
    lineHeight: 14,
  },
  speakReceiptBtn: {
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
    borderRadius: 9,
    paddingVertical: 9,
    alignItems: "center",
    marginTop: 10,
  },
  speakReceiptBtnText: {
    color: "#047857",
    fontSize: 12,
    fontWeight: "800",
  },
  closeReceiptBtn: {
    backgroundColor: "#0F172A",
    borderRadius: 9,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 6,
  },
  closeReceiptBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  // Settings Box
  settingsBox: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
  },
  settingsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  settingsModalTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
  },
  settingsFieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#475569",
    marginBottom: 5,
  },
  settingsInputField: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 12,
    color: "#0F172A",
    backgroundColor: "#F8FAFC",
  },
  presetButtonsRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
  },
  presetButton: {
    backgroundColor: "#E2E8F0",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  presetButtonText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#334155",
  },
  testConnectionButton: {
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 7,
    paddingVertical: 8,
    alignItems: "center",
    marginTop: 8,
  },
  testConnectionButtonText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0F172A",
  },
  testResultBanner: {
    padding: 7,
    borderRadius: 6,
    marginTop: 6,
  },
  testResultBannerSuccess: {
    backgroundColor: "#ECFDF5",
  },
  testResultBannerError: {
    backgroundColor: "#FEF2F2",
  },
  testResultTextSuccess: {
    color: "#047857",
    fontSize: 10,
    fontWeight: "700",
  },
  testResultTextError: {
    color: "#B91C1C",
    fontSize: 10,
    fontWeight: "700",
  },
  saveSettingsButton: {
    backgroundColor: "#059669",
    borderRadius: 9,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 10,
  },
  saveSettingsButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
});
