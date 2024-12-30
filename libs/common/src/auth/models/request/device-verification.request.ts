export class DeviceVerificationRequest {
  unknownDeviceVerificationEnabled: boolean;
  deviceVerificationOtp?: string;

  constructor(unknownDeviceVerificationEnabled: boolean, deviceVerificationOtp?: string) {
    this.unknownDeviceVerificationEnabled = unknownDeviceVerificationEnabled;
    this.deviceVerificationOtp = deviceVerificationOtp;
  }
}
