import {
  isExpired,
  type PacketPriority,
  type ThalamusPacket,
} from "./packet.js";

export type RouteEventType = "route" | "drop" | "expire";

export interface RouteEvent {
  type: RouteEventType;
  packet_id: string;
  source: string;
  target?: string;
  priority: PacketPriority;
  timestamp: number;
  hop_count: number;
  reason?: string;
}

type RouteListener = (packet: ThalamusPacket) => void;

export class ThalamusRouter {
  private readonly queues: Record<PacketPriority, ThalamusPacket[]> = {
    0: [],
    1: [],
    2: [],
  };

  private readonly listeners: Record<RouteEventType, Set<RouteListener>> = {
    route: new Set(),
    drop: new Set(),
    expire: new Set(),
  };

  private readonly auditLog: RouteEvent[] = [];

  enqueue(packet: ThalamusPacket): void {
    this.queues[packet.priority].push(packet);
  }

  route(): ThalamusPacket | null {
    let packet = this.popNext();

    while (packet !== null) {
      packet.hop_count += 1;

      if (isExpired(packet)) {
        this.record("expire", packet, "max_hops reached");
        packet = this.popNext();
        continue;
      }

      if (this.hasVisitedTarget(packet)) {
        this.record("drop", packet, "cycle prevented");
        packet = this.popNext();
        continue;
      }

      this.markTargetVisited(packet);
      this.record("route", packet);
      return packet;
    }

    return null;
  }

  inspect(): { high: number; mid: number; low: number } {
    return {
      high: this.queues[0].length,
      mid: this.queues[1].length,
      low: this.queues[2].length,
    };
  }

  on(event: RouteEventType, cb: RouteListener): void {
    this.listeners[event].add(cb);
  }

  getAuditLog(): RouteEvent[] {
    return this.auditLog.map((event) => ({ ...event }));
  }

  private popNext(): ThalamusPacket | null {
    for (const priority of [0, 1, 2] as const) {
      const packet = this.queues[priority].shift();
      if (packet !== undefined) {
        return packet;
      }
    }

    return null;
  }

  private record(
    type: RouteEventType,
    packet: ThalamusPacket,
    reason?: string,
  ): void {
    this.auditLog.push({
      type,
      packet_id: packet.id,
      source: packet.source,
      ...(packet.target === undefined ? {} : { target: packet.target }),
      priority: packet.priority,
      timestamp: Date.now(),
      hop_count: packet.hop_count,
      ...(reason === undefined ? {} : { reason }),
    });

    for (const listener of this.listeners[type]) {
      listener(packet);
    }
  }

  private hasVisitedTarget(packet: ThalamusPacket): boolean {
    if (packet.target === undefined) {
      return false;
    }

    return readVisitedModules(packet).includes(packet.target);
  }

  private markTargetVisited(packet: ThalamusPacket): void {
    if (packet.target === undefined) {
      return;
    }

    const visited = readVisitedModules(packet);
    if (!visited.includes(packet.target)) {
      packet.metadata.visited_modules = [...visited, packet.target];
    }
  }
}

function readVisitedModules(packet: ThalamusPacket): string[] {
  const value = packet.metadata.visited_modules;
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
