import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import type { EngineInstall, InstanceInfo } from "@/state/store";
import { cn } from "@/lib/cn";

type HostPlatform = "darwin" | "win32" | "linux";

function hostPlatform(): HostPlatform {
  const platform = window.cumea?.platform;
  if (platform === "darwin" || platform === "win32" || platform === "linux") return platform;
  if (navigator.userAgent.includes("Mac")) return "darwin";
  if (navigator.userAgent.includes("Win")) return "win32";
  return "linux";
}

export function installCommandFor(install: EngineInstall | undefined): string | null {
  return install?.command?.[hostPlatform()] ?? null;
}

export function needsSignIn(instance: InstanceInfo | undefined): boolean {
  return instance?.snapshot.state === "available" && instance.snapshot.authenticated === false;
}

function CommandRow({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard permission can be denied in a browser. The selectable
      // command remains visible and no fallback executes anything.
    }
  };

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <code className="block select-all overflow-x-auto rounded-lg bg-app px-2.5 py-2 font-mono text-[12px] leading-relaxed text-ink-secondary">
        {command}
      </code>
      <button
        type="button"
        onClick={() => void copy()}
        className="flex w-fit items-center gap-1.5 rounded-lg bg-raised px-2.5 py-1.5 text-[12.5px] text-ink hover:bg-raised-hover"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? "Copied" : "Copy command"}
      </button>
    </div>
  );
}

export function EngineSetup({ instance, className }: { instance: InstanceInfo; className?: string }) {
  const install = instance.install;
  const installCommand = installCommandFor(install);
  const signInOnly = needsSignIn(instance);

  if (!install) {
    return (
      <p className={cn("text-[12.5px] leading-relaxed text-ink-secondary", className)}>
        {instance.snapshot.reason ?? "This engine is not available on this machine."}
      </p>
    );
  }

  return (
    <div className={cn("text-[12.5px] leading-relaxed text-ink-secondary", className)}>
      {signInOnly ? (
        <>
          <p>{instance.displayName} is installed but needs an interactive sign-in.</p>
          {install.signInCommand ? <CommandRow command={install.signInCommand} /> : null}
        </>
      ) : installCommand ? (
        <>
          <p>
            Install {instance.displayName} in a terminal
            {install.signInCommand ? `, then run ${install.signInCommand} to sign in` : ""}.
          </p>
          <CommandRow command={installCommand} />
          {install.needsNode ? (
            <p className="mt-1.5 text-[11.5px] text-ink-secondary/70">Requires Node.js and npm.</p>
          ) : null}
        </>
      ) : (
        <p>No verified one-line installer is available for this platform.</p>
      )}

      {install.docsUrl ? (
        <a
          href={install.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] text-accent hover:underline"
        >
          <ExternalLink size={12} /> Official setup guide
        </a>
      ) : null}
    </div>
  );
}
