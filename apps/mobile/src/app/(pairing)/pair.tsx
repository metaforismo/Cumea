import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Linking, ScrollView, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Crypto from "expo-crypto";
import { SafeAreaView } from "react-native-safe-area-context";
import { MoteAvatar } from "@/components/mote-avatar";
import { PressableScale } from "@/components/pressable-scale";
import { parsePairingUri } from "@/host/host-client";
import type { PairingClaimInput } from "@/host/types";
import { useCumea } from "@/state/cumea-store";
import { useCumeaTheme } from "@/theme";

type EntryMode = "paste" | "manual";
const avatar = { version: 1 as const, kind: "mote" as const, shapeId: "drop" as const, color: "#f56a16", motion: "playful" as const };

async function verificationCode(secret: string): Promise<string> {
  if (!secret) return "";
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, secret, {
    encoding: Crypto.CryptoEncoding.HEX,
  });
  return String(Number.parseInt(digest.slice(0, 8), 16) % 1_000_000).padStart(6, "0");
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secret = false,
}: {
  label: string;
  value: string;
  onChangeText(value: string): void;
  placeholder: string;
  secret?: boolean;
}) {
  const { theme } = useCumeaTheme();
  return (
    <View style={{ gap: 7 }}>
      <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "700" }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secret}
        autoComplete={secret ? "off" : undefined}
        importantForAutofill={secret ? "no" : "auto"}
        textContentType={secret ? "none" : undefined}
        style={{ minHeight: 50, borderRadius: 14, borderCurve: "continuous", borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.input, color: theme.text, fontSize: 15, paddingHorizontal: 14 }}
      />
    </View>
  );
}

export default function PairScreen() {
  const { theme } = useCumeaTheme();
  const { state, actions } = useCumea();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mode, setMode] = useState<EntryMode>("paste");
  const [pairingData, setPairingData] = useState("");
  const [hostUrl, setHostUrl] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const manualInput = useMemo<PairingClaimInput>(() => ({ hostUrl, sessionId, secret }), [hostUrl, secret, sessionId]);

  const hydrate = (raw: string) => {
    setScanning(false);
    try {
      const parsed = parsePairingUri(raw);
      setPairingData("");
      setHostUrl(parsed.hostUrl);
      setSessionId(parsed.sessionId);
      setSecret(parsed.secret);
      setMode("manual");
      setLocalError(null);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    let alive = true;
    setConfirmed(false);
    void verificationCode(secret)
      .then((value) => alive && setCode(value))
      .catch(() => alive && setCode(""));
    return () => {
      alive = false;
    };
  }, [hostUrl, secret, sessionId]);

  const openScanner = async () => {
    setLocalError(null);
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        setLocalError("Camera access is only used to scan the one-time QR code. You can still paste its payload or enter the fields manually.");
        return;
      }
    }
    setScanning(true);
  };

  const submit = async () => {
    setLocalError(null);
    try {
      if (!confirmed) throw new Error("Compare the six-digit code on both devices, then confirm that it matches.");
      setSubmitting(true);
      await actions.pair(manualInput);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <KeyboardAvoidingView behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 22, paddingTop: 18, paddingBottom: 28, gap: 22 }}
        >
          <View style={{ alignItems: "center", gap: 12 }}>
            <MoteAvatar config={avatar} size={74} label="Cumea" />
            <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 31, lineHeight: 36, fontWeight: "800", letterSpacing: -0.8, textAlign: "center" }}>
              Connect your Cumea host
            </Text>
            <Text style={{ maxWidth: 430, color: theme.textSecondary, fontSize: 15, lineHeight: 22, textAlign: "center" }}>
              Create a pairing session on Cumea desktop or your own VM. Scan or paste its credentials inside this app; links opened by iOS or Android are never used for pairing.
            </Text>
          </View>

          <View style={{ flexDirection: "row", borderRadius: 13, backgroundColor: theme.card, padding: 3 }}>
            {(["paste", "manual"] as const).map((value) => (
              <PressableScale
                key={value}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === value }}
                accessibilityLabel={value === "paste" ? "Scan or paste pairing data" : "Enter pairing fields manually"}
                onPress={() => {
                  setMode(value);
                  setConfirmed(false);
                  setScanning(false);
                  setLocalError(null);
                  if (value === "manual") setPairingData("");
                }}
                style={{ flex: 1, minHeight: 42, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: mode === value ? theme.cardRaised : "transparent" }}
              >
                <Text style={{ color: mode === value ? theme.text : theme.textSecondary, fontSize: 14, fontWeight: "700" }}>
                  {value === "paste" ? "Scan or paste" : "Manual fields"}
                </Text>
              </PressableScale>
            ))}
          </View>

          {scanning ? (
            <View style={{ gap: 12 }}>
              <View style={{ height: 330, overflow: "hidden", borderRadius: 22, borderCurve: "continuous", backgroundColor: theme.card }}>
                <CameraView
                  style={{ flex: 1 }}
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={({ data }) => hydrate(data)}
                />
                <View pointerEvents="none" style={{ position: "absolute", top: 52, right: 42, bottom: 52, left: 42, borderRadius: 22, borderWidth: 2, borderColor: theme.text }} />
              </View>
              <Text style={{ color: theme.textSecondary, fontSize: 13, lineHeight: 19, textAlign: "center" }}>
                Point the camera at the QR code shown by your host. Cumea does not retain camera images.
              </Text>
              <PressableScale onPress={() => setScanning(false)} accessibilityRole="button" style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: theme.text, fontSize: 15, fontWeight: "700" }}>Cancel scan</Text>
              </PressableScale>
            </View>
          ) : mode === "paste" ? (
            <View style={{ gap: 12 }}>
              <Field label="PAIRING DATA" value={pairingData} onChangeText={setPairingData} placeholder="Paste the payload shown by your Cumea host" secret />
              <View style={{ flexDirection: "row", gap: 9 }}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Scan pairing QR code"
                  accessibilityHint="Opens the in-app camera scanner without accepting links from other apps"
                  onPress={() => void openScanner()}
                  style={{ flex: 1, minHeight: 48, borderRadius: 24, borderWidth: 1, borderColor: theme.hairline, alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ color: theme.text, fontSize: 15, fontWeight: "700" }}>Scan QR</Text>
                </PressableScale>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel="Review pasted pairing data"
                  accessibilityHint="Reads the host URL, session ID, and one-time secret only after you press this button"
                  onPress={() => hydrate(pairingData)}
                  style={{ flex: 1, minHeight: 48, borderRadius: 24, backgroundColor: theme.cardRaised, alignItems: "center", justifyContent: "center" }}
                >
                  <Text style={{ color: theme.text, fontSize: 15, fontWeight: "700" }}>Review data</Text>
                </PressableScale>
              </View>
              <Text style={{ color: theme.textSecondary, fontSize: 12, lineHeight: 18, textAlign: "center" }}>
                Cumea ignores pairing data from app-launch URLs. Only an in-app scan, an explicit paste, or manual entry can populate these credentials.
              </Text>
            </View>
          ) : (
            <View style={{ gap: 13 }}>
              <Field label="HOST URL" value={hostUrl} onChangeText={setHostUrl} placeholder="https://cumea.example.com" />
              <Field label="SESSION ID" value={sessionId} onChangeText={setSessionId} placeholder="Pairing session UUID" />
              <Field label="ONE-TIME SECRET" value={secret} onChangeText={setSecret} placeholder="Secret from the pairing QR" secret />
            </View>
          )}

          {code ? (
            <View style={{ gap: 12, borderRadius: 18, borderCurve: "continuous", borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, padding: 16 }}>
              <Text style={{ color: theme.textSecondary, fontSize: 12, fontWeight: "700" }}>VERIFY ON YOUR HOST</Text>
              <Text accessibilityLabel={`Verification code ${code.split("").join(" ")}`} style={{ color: theme.text, fontSize: 30, fontWeight: "800", letterSpacing: 6, fontVariant: ["tabular-nums"] }}>{code}</Text>
              <PressableScale
                accessibilityRole="checkbox"
                accessibilityState={{ checked: confirmed }}
                onPress={() => setConfirmed((value) => !value)}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 }}
              >
                <View style={{ width: 23, height: 23, borderRadius: 7, borderWidth: 1, borderColor: confirmed ? theme.success : theme.hairline, backgroundColor: confirmed ? theme.success : theme.input, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: theme.background, fontWeight: "900" }}>{confirmed ? "✓" : ""}</Text>
                </View>
                <Text style={{ flex: 1, color: theme.text, fontSize: 14, lineHeight: 20 }}>This code matches the one shown on my Cumea host.</Text>
              </PressableScale>
            </View>
          ) : null}

          {localError || state.error ? (
            <View accessibilityRole="alert" style={{ borderRadius: 13, backgroundColor: `${theme.danger}1f`, padding: 12, gap: 8 }}>
              <Text style={{ color: theme.danger, fontSize: 13, lineHeight: 19 }}>{localError ?? state.error}</Text>
              {cameraPermission && !cameraPermission.granted && !cameraPermission.canAskAgain ? (
                <PressableScale accessibilityRole="button" onPress={() => void Linking.openSettings()} style={{ alignSelf: "flex-start", minHeight: 34, justifyContent: "center" }}>
                  <Text style={{ color: theme.text, fontSize: 13, fontWeight: "700" }}>Open system settings</Text>
                </PressableScale>
              ) : null}
            </View>
          ) : null}

          <View style={{ marginTop: "auto", gap: 10 }}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="Pair this phone"
              disabled={submitting || !confirmed}
              onPress={() => void submit()}
              style={{ minHeight: 54, borderRadius: 27, backgroundColor: theme.text, opacity: submitting || !confirmed ? 0.45 : 1, alignItems: "center", justifyContent: "center" }}
            >
              {submitting ? <ActivityIndicator color={theme.background} /> : <Text style={{ color: theme.background, fontSize: 17, fontWeight: "800" }}>Pair this phone</Text>}
            </PressableScale>
            {__DEV__ ? (
              <PressableScale accessibilityRole="button" onPress={() => void actions.enterDemo()} style={{ minHeight: 45, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: theme.textSecondary, fontSize: 14, fontWeight: "700" }}>Explore local demo data</Text>
              </PressableScale>
            ) : null}
            <Text style={{ color: theme.textSecondary, fontSize: 11, lineHeight: 16, textAlign: "center" }}>
              The six-digit code is only a human comparison. Pairing always requires the high-entropy secret scanned or pasted inside this app, or entered manually.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
