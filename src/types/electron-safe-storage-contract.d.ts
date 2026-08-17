import type { safeStorage } from "electron";

type SafeStorage = typeof safeStorage;
type Assert<T extends true> = T;
type Returns<TFunction, TValue> = TFunction extends (...args: never[]) => infer TResult
  ? TResult extends TValue
    ? true
    : false
  : false;

type AsyncDecryptResult = Promise<{
  result: string;
  shouldReEncrypt: boolean;
}>;

type _AsyncAvailabilityReturnsPromise = Assert<
  Returns<SafeStorage["isAsyncEncryptionAvailable"], Promise<boolean>>
>;
type _AsyncEncryptionReturnsBufferPromise = Assert<
  Returns<SafeStorage["encryptStringAsync"], Promise<Buffer>>
>;
type _AsyncDecryptionReturnsRotationMetadata = Assert<
  Returns<SafeStorage["decryptStringAsync"], AsyncDecryptResult>
>;
type _LinuxBackendIsInspectable = SafeStorage["getSelectedStorageBackend"];
