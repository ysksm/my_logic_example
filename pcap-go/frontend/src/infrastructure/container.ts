// Composition root: wires concrete adapters into application services.

import { CaptureService } from "@application/captureService";
import { HttpCaptureGateway } from "./httpCaptureGateway";
import { WsPacketStream } from "./wsPacketStream";

export const captureGateway = new HttpCaptureGateway();
export const packetStream = new WsPacketStream();
export const captureService = new CaptureService(captureGateway);
