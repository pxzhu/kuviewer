export interface ConnectorStatus {
  mode: string;
  source: string;
  readOnly: boolean;
  secrets: string;
  static: boolean;
  serverTime: string;
}
