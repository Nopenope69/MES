import { EventEmitter } from 'events';
import { CfxMessageEnvelope } from './cfx-message.interface';

export interface AmqpDeliveryReceipt {
  deliveryTag: string;
  settled: boolean;
  accepted: boolean;
  publishedAt: string;
}

export type CfxMessageHandler<T = any> = (message: CfxMessageEnvelope<T>) => Promise<void> | void;

/**
 * In-Process Mock AMQP 1.0 CFX Broker.
 * Implements standard AMQP topic exchange semantics for IPC-2591 messaging.
 * Allows 100% of the SMT MES to operate self-contained in Docker or automated CI tests.
 */
export class MockCfxAmqpBroker {
  private static instance: MockCfxAmqpBroker | null = null;
  private emitter: EventEmitter = new EventEmitter();
  private publishedMessages: Array<{ topic: string; message: CfxMessageEnvelope; publishedAt: string }> = [];

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  public static getInstance(): MockCfxAmqpBroker {
    if (!this.instance) {
      this.instance = new MockCfxAmqpBroker();
    }
    return this.instance;
  }

  public async publish<T>(topic: string, message: CfxMessageEnvelope<T>): Promise<AmqpDeliveryReceipt> {
    const publishedAt = new Date().toISOString();
    const deliveryTag = `del-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    this.publishedMessages.push({ topic, message, publishedAt });
    this.emitter.emit(topic.toLowerCase(), message);
    this.emitter.emit('*', { topic, message });

    return {
      deliveryTag,
      settled: true,
      accepted: true,
      publishedAt
    };
  }

  public subscribe<T>(topic: string, handler: CfxMessageHandler<T>): void {
    this.emitter.on(topic.toLowerCase(), handler);
  }

  public unsubscribe<T>(topic: string, handler: CfxMessageHandler<T>): void {
    this.emitter.off(topic.toLowerCase(), handler);
  }

  public getPublishedMessages(topicFilter?: string) {
    if (!topicFilter) return [...this.publishedMessages];
    return this.publishedMessages.filter(m => m.topic.toLowerCase() === topicFilter.toLowerCase());
  }

  public clear(): void {
    this.publishedMessages = [];
    this.emitter.removeAllListeners();
  }
}
