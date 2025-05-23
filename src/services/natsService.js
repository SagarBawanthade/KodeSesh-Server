import { connect, StringCodec, JSONCodec } from 'nats';

class NATSService {
  constructor() {
    this.nc = null;
    this.jc = JSONCodec();
    this.sc = StringCodec();
    this.subscriptions = new Map();
  }

  async connect(servers = 'nats://localhost:4222') {
    try {
      this.nc = await connect({ 
        servers,
        reconnect: true,
        maxReconnectAttempts: -1,
        reconnectTimeWait: 2000,
        name: 'kodesesh-backend'
      });
      
      console.log('✅ Connected to NATS server');
      
      // Handle connection events
      (async () => {
        for await (const status of this.nc.status()) {
          console.log(`NATS connection status: ${status.type}`);
        }
      })();
      
      return true;
    } catch (error) {
      console.error('❌ NATS connection error:', error);
      return false;
    }
  }

  // Publish PR event
  async publishPREvent(sessionId, eventType, prData) {
    if (!this.nc) {
      console.error('NATS not connected');
      return false;
    }

    const subject = `pr.${sessionId}.${eventType}`;
    const data = {
      sessionId,
      eventType,
      prData,
      timestamp: new Date().toISOString()
    };

    try {
      await this.nc.publish(subject, this.jc.encode(data));
      console.log(`📤 Published PR event: ${subject}`);
      return true;
    } catch (error) {
      console.error('Error publishing PR event:', error);
      return false;
    }
  }

  // Subscribe to PR events for a session
  async subscribeToPREvents(sessionId, callback) {
    if (!this.nc) {
      console.error('NATS not connected');
      return null;
    }

    const subject = `pr.${sessionId}.*`;
    
    try {
      const sub = this.nc.subscribe(subject);
      
      // Store subscription
      this.subscriptions.set(`pr-${sessionId}`, sub);
      
      // Process messages
      (async () => {
        for await (const msg of sub) {
          try {
            const data = this.jc.decode(msg.data);
            callback(data);
          } catch (error) {
            console.error('Error processing PR message:', error);
          }
        }
      })();
      
      console.log(`📥 Subscribed to PR events: ${subject}`);
      return sub;
    } catch (error) {
      console.error('Error subscribing to PR events:', error);
      return null;
    }
  }

  // Unsubscribe from PR events
  async unsubscribeFromPREvents(sessionId) {
    const key = `pr-${sessionId}`;
    const sub = this.subscriptions.get(key);
    
    if (sub) {
      await sub.unsubscribe();
      this.subscriptions.delete(key);
      console.log(`🔕 Unsubscribed from PR events for session: ${sessionId}`);
    }
  }

  // Request PR sync across all instances
  async requestPRSync(sessionId, userId) {
    const subject = `pr.sync.request`;
    const data = { sessionId, userId, timestamp: new Date().toISOString() };
    
    try {
      await this.nc.publish(subject, this.jc.encode(data));
      console.log(`📨 Requested PR sync for session: ${sessionId}`);
      return true;
    } catch (error) {
      console.error('Error requesting PR sync:', error);
      return false;
    }
  }

  // Close connection
  async close() {
    if (this.nc) {
      await this.nc.close();
      console.log('NATS connection closed');
    }
  }
}

export default new NATSService();