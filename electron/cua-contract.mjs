export function normalizeCuaPermissions(status) {
  return {
    accessibility: status?.accessibility === true,
    screenRecording: status?.screenRecording === true,
  };
}

export function toPublicCuaStatus(connection) {
  if (!connection) {
    return {
      state: "checking",
      mode: null,
      permissions: null,
      reason: null,
      driverVersion: null,
    };
  }
  return {
    state: connection.state ?? (connection.mcpCommand ? "ready" : "unavailable"),
    mode: connection.mode ?? null,
    permissions: connection.permissions ?? null,
    reason: connection.reason ?? null,
    driverVersion: connection.driverVersion ?? null,
  };
}
