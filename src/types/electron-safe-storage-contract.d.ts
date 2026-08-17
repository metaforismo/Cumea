import type { safeStorage } from "electron";

type SafeStorage = typeof safeStorage;
type Assert<T extends true> = T;
type Returns<TFunction, TValue> = TFunction extends (...args: never[]) => infer TResult
  ? TResult extends TValue
    ? true
    : false
  : false;

type _EncryptionAvailabilityIsSynchronous = Assert<
  Returns<SafeStorage["isEncryptionAvailable"], boolean>
>;
type _EncryptionReturnsBuffer = Assert<Returns<SafeStorage["encryptString"], Buffer>>;
type _DecryptionReturnsString = Assert<Returns<SafeStorage["decryptString"], string>>;
type _LinuxBackendIsInspectable = SafeStorage["getSelectedStorageBackend"];
