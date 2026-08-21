import { useEffect, useMemo, useState } from "react";
import { ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { MoteAvatar } from "@/components/mote-avatar";
import { PressableScale } from "@/components/pressable-scale";
import type { AvatarConfig, RoutineOccurrence, RoutineSchedule, RoutineSummary } from "@/host/types";
import { useCumea } from "@/state/cumea-store";
import { useCumeaTheme } from "@/theme";

const fallback: AvatarConfig = { version: 1, kind: "mote", shapeId: "soft", color: "#2f8de3", motion: "calm" };
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function nextLabel(timestamp: number | null): string {
  if (!timestamp) return "No next run";
  return `Next ${new Date(timestamp).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}

function RoutineEditor({ routine, onDone }: { routine: RoutineSummary; onDone: () => void }) {
  const { theme } = useCumeaTheme();
  const { actions } = useCumea();
  const [name, setName] = useState(routine.name);
  const [prompt, setPrompt] = useState(routine.prompt);
  const [kind, setKind] = useState<RoutineSchedule["kind"]>(routine.scheduleSpec.kind);
  const [time, setTime] = useState(routine.scheduleSpec.kind === "interval" ? "09:00" : routine.scheduleSpec.time);
  const [minutes, setMinutes] = useState(routine.scheduleSpec.kind === "interval" ? String(routine.scheduleSpec.everyMinutes) : "60");
  const [weekday, setWeekday] = useState(routine.scheduleSpec.kind === "weekly" ? routine.scheduleSpec.weekdays[0] ?? 1 : 1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const schedule: RoutineSchedule = kind === "interval"
        ? { kind, everyMinutes: Number(minutes) }
        : kind === "weekly"
          ? { kind, time, timezone, weekdays: [weekday] }
          : { kind, time, timezone };
      await actions.updateRoutine(routine, {
        name: name.trim(),
        ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
        schedule,
      });
      onDone();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: theme.hairline, paddingTop: 12 }}>
      <TextInput
        accessibilityLabel="Routine name"
        value={name}
        onChangeText={setName}
        placeholder="Routine name"
        placeholderTextColor={theme.textSecondary}
        style={{ minHeight: 44, borderRadius: 12, borderCurve: "continuous", backgroundColor: theme.background, color: theme.text, paddingHorizontal: 12, fontSize: 15 }}
      />
      <TextInput
        accessibilityLabel="Routine task"
        value={prompt}
        onChangeText={setPrompt}
        multiline
        placeholder="Leave blank to keep the current task"
        placeholderTextColor={theme.textSecondary}
        style={{ minHeight: 88, borderRadius: 12, borderCurve: "continuous", backgroundColor: theme.background, color: theme.text, padding: 12, fontSize: 14, textAlignVertical: "top" }}
      />
      <View accessibilityRole="radiogroup" accessibilityLabel="Schedule frequency" style={{ flexDirection: "row", gap: 7 }}>
        {(["daily", "weekly", "interval"] as const).map((value) => (
          <PressableScale
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ selected: kind === value }}
            onPress={() => setKind(value)}
            style={{ minHeight: 42, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 12, borderCurve: "continuous", backgroundColor: kind === value ? theme.text : theme.background }}
          >
            <Text style={{ color: kind === value ? theme.background : theme.text, fontSize: 12, fontWeight: "700", textTransform: "capitalize" }}>{value}</Text>
          </PressableScale>
        ))}
      </View>
      {kind === "interval" ? (
        <TextInput
          accessibilityLabel="Minutes between runs"
          keyboardType="number-pad"
          value={minutes}
          onChangeText={setMinutes}
          style={{ minHeight: 44, borderRadius: 12, borderCurve: "continuous", backgroundColor: theme.background, color: theme.text, paddingHorizontal: 12, fontSize: 15 }}
        />
      ) : (
        <TextInput
          accessibilityLabel="Run time in 24 hour format"
          value={time}
          onChangeText={setTime}
          placeholder="09:00"
          placeholderTextColor={theme.textSecondary}
          style={{ minHeight: 44, borderRadius: 12, borderCurve: "continuous", backgroundColor: theme.background, color: theme.text, paddingHorizontal: 12, fontSize: 15, fontVariant: ["tabular-nums"] }}
        />
      )}
      {kind === "weekly" ? (
        <View accessibilityRole="radiogroup" accessibilityLabel="Weekday" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {weekdays.map((label, index) => (
            <PressableScale
              key={label}
              accessibilityRole="radio"
              accessibilityState={{ selected: weekday === index }}
              onPress={() => setWeekday(index)}
              style={{ minWidth: 42, minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 11, borderCurve: "continuous", backgroundColor: weekday === index ? theme.text : theme.background }}
            >
              <Text style={{ color: weekday === index ? theme.background : theme.text, fontSize: 11, fontWeight: "700" }}>{label}</Text>
            </PressableScale>
          ))}
        </View>
      ) : null}
      {error ? <Text selectable accessibilityRole="alert" style={{ color: theme.danger, fontSize: 12 }}>{error}</Text> : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <PressableScale accessibilityRole="button" onPress={onDone} style={{ minHeight: 44, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 12, borderCurve: "continuous", backgroundColor: theme.background }}>
          <Text style={{ color: theme.text, fontWeight: "700" }}>Cancel</Text>
        </PressableScale>
        <PressableScale accessibilityRole="button" accessibilityState={{ disabled: saving || !name.trim() }} disabled={saving || !name.trim()} onPress={() => void save()} style={{ minHeight: 44, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 12, borderCurve: "continuous", backgroundColor: theme.text, opacity: saving || !name.trim() ? 0.45 : 1 }}>
          <Text style={{ color: theme.background, fontWeight: "800" }}>{saving ? "Saving…" : "Save"}</Text>
        </PressableScale>
      </View>
    </View>
  );
}

export default function RoutinesScreen() {
  const { theme } = useCumeaTheme();
  const router = useRouter();
  const { state, actions } = useCumea();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [calendarView, setCalendarView] = useState<"agenda" | "week">("agenda");
  const [occurrences, setOccurrences] = useState<RoutineOccurrence[]>([]);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const from = Date.now();
    void actions.routineOccurrences(from, from + 7 * 24 * 60 * 60_000)
      .then((items) => {
        if (active) {
          setOccurrences(items);
          setCalendarError(null);
        }
      })
      .catch((reason) => {
        if (active) setCalendarError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { active = false; };
  }, [actions, state.routines]);

  const days = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, offset) => {
      const date = new Date(start);
      date.setDate(start.getDate() + offset);
      const next = new Date(date);
      next.setDate(date.getDate() + 1);
      return {
        key: date.toISOString(),
        label: date.toLocaleDateString([], { weekday: "short", day: "numeric" }),
        occurrences: occurrences.filter((item) => item.scheduledFor >= date.getTime() && item.scheduledFor < next.getTime()),
      };
    });
  }, [occurrences]);

  const runNow = async (routine: RoutineSummary) => {
    setRunningId(routine.id);
    try {
      await actions.runRoutine(routine);
      setCalendarError(null);
    } catch (reason) {
      setCalendarError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunningId(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ height: 62, flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: theme.hairline, paddingHorizontal: 12 }}>
        <PressableScale accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: theme.text, fontSize: 31 }}>‹</Text>
        </PressableScale>
        <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 20, fontWeight: "800" }}>Routines</Text>
      </View>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: 17, gap: 11 }}>
        <View style={{ borderRadius: 14, borderCurve: "continuous", backgroundColor: theme.card, padding: 13 }}>
          <Text selectable style={{ color: theme.textSecondary, fontSize: 12, lineHeight: 18 }}>
            Paired mobile can change only this routine’s name, task, schedule and enabled state, or request Run now. Agent permissions, providers, secrets and devices stay host-only.
          </Text>
        </View>
        <View accessibilityLabel="Upcoming routine calendar" style={{ gap: 10, borderRadius: 18, borderCurve: "continuous", backgroundColor: theme.card, padding: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 16, fontWeight: "800" }}>Next 7 days</Text>
              <Text style={{ color: theme.textSecondary, fontSize: 11 }}>{Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"}</Text>
            </View>
            <View accessibilityRole="radiogroup" accessibilityLabel="Calendar view" style={{ flexDirection: "row", gap: 5, borderRadius: 11, borderCurve: "continuous", backgroundColor: theme.background, padding: 3 }}>
              {(["agenda", "week"] as const).map((view) => (
                <PressableScale
                  key={view}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: calendarView === view }}
                  onPress={() => setCalendarView(view)}
                  style={{ minHeight: 36, justifyContent: "center", borderRadius: 9, borderCurve: "continuous", backgroundColor: calendarView === view ? theme.card : theme.background, paddingHorizontal: 10 }}
                >
                  <Text style={{ color: theme.text, fontSize: 11, fontWeight: "700", textTransform: "capitalize" }}>{view}</Text>
                </PressableScale>
              ))}
            </View>
          </View>
          {calendarError ? <Text selectable accessibilityRole="alert" style={{ color: theme.danger, fontSize: 12 }}>{calendarError}</Text> : null}
          {calendarView === "week" ? (
            <View accessibilityRole="list" accessibilityLabel="Week projection" style={{ flexDirection: "row", gap: 4 }}>
              {days.map((day) => (
                <View key={day.key} accessible accessibilityLabel={`${day.label}, ${day.occurrences.length} runs`} style={{ minHeight: 64, flex: 1, alignItems: "center", justifyContent: "center", gap: 3, borderRadius: 10, borderCurve: "continuous", backgroundColor: theme.background, paddingVertical: 7 }}>
                  <Text numberOfLines={1} style={{ color: theme.textSecondary, fontSize: 9 }}>{day.label}</Text>
                  <Text style={{ color: theme.text, fontSize: 15, fontWeight: "800", fontVariant: ["tabular-nums"] }}>{day.occurrences.length}</Text>
                </View>
              ))}
            </View>
          ) : occurrences.length ? (
            <View accessibilityRole="list" accessibilityLabel="Upcoming occurrences" style={{ gap: 5 }}>
              {occurrences.slice(0, 20).map((occurrence) => {
                const routine = state.routines.find((candidate) => candidate.id === occurrence.routineId);
                if (!routine) return null;
                return (
                  <View key={`${occurrence.routineId}:${occurrence.scheduledFor}`} accessible accessibilityLabel={`${routine.name}, ${new Date(occurrence.scheduledFor).toLocaleString()}`} style={{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 10, borderCurve: "continuous", backgroundColor: theme.background, paddingHorizontal: 10 }}>
                    <Text style={{ width: 72, color: theme.textSecondary, fontSize: 10, fontVariant: ["tabular-nums"] }}>{new Date(occurrence.scheduledFor).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}</Text>
                    <Text numberOfLines={1} style={{ flex: 1, color: theme.text, fontSize: 12, fontWeight: "600" }}>{routine.name}</Text>
                  </View>
                );
              })}
            </View>
          ) : <Text style={{ color: theme.textSecondary, fontSize: 12, textAlign: "center", paddingVertical: 8 }}>No enabled routines in the next 7 days.</Text>}
        </View>
        {state.routines.length ? state.routines.map((routine) => {
          const agent = state.agents.find((candidate) => candidate.id === routine.agentId);
          const editing = editingId === routine.id;
          return (
            <View key={routine.id} style={{ gap: 12, borderRadius: 18, borderCurve: "continuous", backgroundColor: theme.card, padding: 14 }}>
              <View style={{ minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12 }}>
                <MoteAvatar config={agent?.avatar ?? fallback} size={46} label={routine.agentName} presence={routine.lastStatus === "running" ? "working" : "idle"} />
                <PressableScale accessibilityRole="button" accessibilityLabel={`Edit ${routine.name}`} onPress={() => setEditingId(editing ? null : routine.id)} style={{ flex: 1, gap: 4 }}>
                  <Text numberOfLines={1} style={{ color: theme.text, fontSize: 16, fontWeight: "700" }}>{routine.name}</Text>
                  <Text numberOfLines={1} style={{ color: theme.textSecondary, fontSize: 12 }}>{routine.schedule}</Text>
                  <Text numberOfLines={1} style={{ color: routine.lastStatus === "failed" || routine.lastStatus === "missed" ? theme.danger : theme.textSecondary, fontSize: 11 }}>
                    {nextLabel(routine.nextRunAt)}{routine.lastStatus ? ` · ${routine.lastStatus}` : ""}
                  </Text>
                </PressableScale>
                <Switch
                  accessibilityLabel={`${routine.enabled ? "Pause" : "Enable"} ${routine.name}`}
                  value={routine.enabled}
                  onValueChange={() => void actions.toggleRoutine(routine)}
                  trackColor={{ false: theme.hairline, true: theme.success }}
                  thumbColor={theme.text}
                />
              </View>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Run ${routine.name} now`}
                accessibilityState={{ disabled: runningId === routine.id || routine.lastStatus === "running" }}
                disabled={runningId === routine.id || routine.lastStatus === "running"}
                onPress={() => void runNow(routine)}
                style={{ minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 12, borderCurve: "continuous", backgroundColor: theme.background, opacity: runningId === routine.id || routine.lastStatus === "running" ? 0.45 : 1 }}
              >
                <Text style={{ color: theme.text, fontSize: 13, fontWeight: "700" }}>{runningId === routine.id ? "Starting…" : "Run now"}</Text>
              </PressableScale>
              {editing ? <RoutineEditor routine={routine} onDone={() => setEditingId(null)} /> : null}
            </View>
          );
        }) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 9, padding: 30 }}>
            <Text style={{ color: theme.text, fontSize: 20, fontWeight: "800" }}>No routines yet.</Text>
            <Text style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 20, textAlign: "center" }}>Teach or create a routine on your Cumea host and it will appear here.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
