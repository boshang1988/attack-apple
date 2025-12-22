import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { getSecretValue, setSecretValue } from '../core/secretStore.js';
import type { SecretName } from '../core/secretStore.js';

export interface EmailConfig {
  smtpUser: string;
  smtpPassword: string;
  smtpProvider?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpFromName?: string;
  useTls?: boolean;
  useSsl?: boolean;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: Array<{
    filename: string;
    path?: string;
    content?: Buffer | string;
    contentType?: string;
  }>;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  response?: string;
  error?: string;
  timestamp: string;
  bounced?: boolean;
  bounceReason?: string;
  permanentFailure?: boolean;
}

export interface BulkEmailOptions {
  emails: Array<{ to: string; subject: string; text: string }>;
  delayBetweenEmails?: number; // ms
  maxRetries?: number;
  stopOnError?: boolean;
}

export class EmailTools {
  private configDir: string;
  private logDir: string;

  constructor() {
    this.configDir = join(homedir(), '.agi', 'email');
    this.logDir = join(homedir(), '.agi', 'email-logs');
    
    [this.configDir, this.logDir].forEach(dir => {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    });
  }

  /**
   * Save SMTP configuration to secret store
   */
  async saveConfig(config: EmailConfig): Promise<boolean> {
    try {
      // Save basic SMTP credentials
      setSecretValue('SMTP_USER', config.smtpUser);
      setSecretValue('SMTP_PASSWORD', config.smtpPassword);

      // Save optional configuration
      if (config.smtpProvider) {
        setSecretValue('SMTP_PROVIDER', config.smtpProvider);
      }
      if (config.smtpHost) {
        setSecretValue('SMTP_HOST', config.smtpHost);
      }
      if (config.smtpPort) {
        setSecretValue('SMTP_PORT', config.smtpPort.toString());
      }
      if (config.smtpFromName) {
        setSecretValue('SMTP_FROM_NAME', config.smtpFromName);
      }

      // Also save as JSON file for easy retrieval
      const configFile = join(this.configDir, 'smtp-config.json');
      writeFileSync(configFile, JSON.stringify(config, null, 2));
      
      return true;
    } catch (error) {
      console.error('Failed to save SMTP config:', error);
      return false;
    }
  }

  /**
   * Load SMTP configuration from secret store
   */
  async loadConfig(): Promise<EmailConfig | null> {
    try {
      const smtpUser = getSecretValue('SMTP_USER');
      const smtpPassword = getSecretValue('SMTP_PASSWORD');

      if (!smtpUser || !smtpPassword) {
        return null;
      }

      const config: EmailConfig = {
        smtpUser,
        smtpPassword,
        smtpProvider: getSecretValue('SMTP_PROVIDER') || undefined,
        smtpHost: getSecretValue('SMTP_HOST') || undefined,
        smtpFromName: getSecretValue('SMTP_FROM_NAME') || undefined,
      };

      const port = getSecretValue('SMTP_PORT');
      if (port) {
        config.smtpPort = parseInt(port, 10);
      }

      return config;
    } catch (error) {
      console.error('Failed to load SMTP config:', error);
      return null;
    }
  }

  /**
   * Test SMTP connection with current configuration
   */
  async testConnection(): Promise<EmailResult> {
    const config = await this.loadConfig();
    if (!config) {
      return {
        success: false,
        error: 'No SMTP configuration found. Use --save-smtp first.',
        timestamp: new Date().toISOString()
      };
    }

    try {
      const transporter = this.createTransporter(config);
      await transporter.verify();
      
      // Try to send a test email to self
      const testInfo = await transporter.sendMail({
        from: config.smtpFromName ? `"${config.smtpFromName}" <${config.smtpUser}>` : config.smtpUser,
        to: config.smtpUser,
        subject: 'AGI Email Tools - SMTP Test',
        text: `Test email sent successfully at ${new Date().toISOString()}\n\nSMTP Configuration:\nUser: ${config.smtpUser}\nProvider: ${config.smtpProvider || 'custom'}\nHost: ${config.smtpHost || 'default'}\nPort: ${config.smtpPort || 'default'}`,
        headers: {
          'X-AGI-Test': 'true',
          'X-Timestamp': new Date().toISOString()
        }
      });

      return {
        success: true,
        messageId: testInfo.messageId,
        response: testInfo.response,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Send a single email
   */
  async sendEmail(message: EmailMessage, fromName?: string): Promise<EmailResult> {
    const config = await this.loadConfig();
    if (!config) {
      return {
        success: false,
        error: 'No SMTP configuration found. Use --save-smtp first.',
        timestamp: new Date().toISOString()
      };
    }

    try {
      const transporter = this.createTransporter(config);
      
      const mailOptions = {
        from: fromName || config.smtpFromName 
          ? `"${fromName || config.smtpFromName}" <${config.smtpUser}>` 
          : config.smtpUser,
        to: Array.isArray(message.to) ? message.to.join(', ') : message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        cc: message.cc ? (Array.isArray(message.cc) ? message.cc.join(', ') : message.cc) : undefined,
        bcc: message.bcc ? (Array.isArray(message.bcc) ? message.bcc.join(', ') : message.bcc) : undefined,
        replyTo: message.replyTo,
        headers: {
          'X-AGI-Sent': 'true',
          'X-Timestamp': new Date().toISOString(),
          ...message.headers
        },
        attachments: message.attachments
      };

      const info = await transporter.sendMail(mailOptions);
      
      // Log the email
      this.logEmail({
        to: mailOptions.to,
        subject: mailOptions.subject,
        messageId: info.messageId,
        success: true,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        messageId: info.messageId,
        response: info.response,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStr = String(error);
      
      // Detect bounce conditions
      let bounced = false;
      let bounceReason = '';
      let permanentFailure = false;
      
      // Common bounce patterns
      const bouncePatterns = [
        { pattern: /recipient.*rejected|recipient.*not found/i, permanent: true, reason: 'Recipient not found' },
        { pattern: /mailbox.*not found|mailbox.*does not exist/i, permanent: true, reason: 'Mailbox does not exist' },
        { pattern: /user.*unknown|user.*not found/i, permanent: true, reason: 'Unknown user' },
        { pattern: /address.*not found|address.*invalid/i, permanent: true, reason: 'Invalid address' },
        { pattern: /domain.*not found|domain.*does not exist/i, permanent: true, reason: 'Domain not found' },
        { pattern: /quota.*exceeded|mailbox.*full/i, permanent: false, reason: 'Mailbox full' },
        { pattern: /spam.*rejected|spam.*detected/i, permanent: false, reason: 'Spam rejection' },
        { pattern: /blacklisted|blocked|rejected.*policy/i, permanent: false, reason: 'Blocked by policy' },
        { pattern: /relay.*denied|relay.*not permitted/i, permanent: false, reason: 'Relay denied' },
        { pattern: /550|551|552|553|554/i, permanent: true, reason: 'SMTP permanent failure' },
        { pattern: /450|451/i, permanent: false, reason: 'SMTP temporary failure' },
        { pattern: /bounce|bounced/i, permanent: true, reason: 'Bounced email' }
      ];
      
      for (const pattern of bouncePatterns) {
        if (pattern.pattern.test(errorMessage) || pattern.pattern.test(errorStr)) {
          bounced = true;
          bounceReason = pattern.reason;
          permanentFailure = pattern.permanent;
          break;
        }
      }
      
      const emailLog = {
        to: Array.isArray(message.to) ? message.to.join(', ') : message.to,
        subject: message.subject,
        error: errorMessage,
        success: false,
        bounced,
        bounceReason: bounceReason || undefined,
        permanentFailure,
        timestamp: new Date().toISOString()
      };
      
      this.logEmail(emailLog);
      
      // Save to non-working emails list if bounced
      if (bounced) {
        this.saveNonWorkingEmail({
          email: Array.isArray(message.to) ? message.to[0] : message.to,
          reason: bounceReason,
          permanent: permanentFailure,
          timestamp: new Date().toISOString(),
          error: errorMessage
        });
      }

      return {
        success: false,
        error: errorMessage,
        bounced,
        bounceReason: bounceReason || undefined,
        permanentFailure,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Send bulk emails with rate limiting
   */
  async sendBulkEmails(options: BulkEmailOptions): Promise<Array<EmailResult & { to: string; subject: string }>> {
    const results: Array<EmailResult & { to: string; subject: string }> = [];
    const config = await this.loadConfig();
    
    if (!config) {
      return options.emails.map(email => ({
        to: email.to,
        subject: email.subject,
        success: false,
        error: 'No SMTP configuration found',
        timestamp: new Date().toISOString()
      }));
    }

    const delay = options.delayBetweenEmails || 5000; // 5 seconds default
    const maxRetries = options.maxRetries || 3;
    const stopOnError = options.stopOnError !== false; // default true

    for (let i = 0; i < options.emails.length; i++) {
      const email = options.emails[i];
      let retryCount = 0;
      let success = false;
      let result: EmailResult | null = null;

      while (retryCount < maxRetries && !success) {
        result = await this.sendEmail({
          to: email.to,
          subject: email.subject,
          text: email.text
        });

        if (result.success) {
          success = true;
        } else {
          retryCount++;
          if (retryCount < maxRetries) {
            console.log(`Retrying ${email.to} (${retryCount}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay between retries
          }
        }
      }

      results.push({
        to: email.to,
        subject: email.subject,
        ...(result || {
          success: false,
          error: 'Failed after all retries',
          timestamp: new Date().toISOString()
        })
      });

      // Stop if requested and this email failed
      if (stopOnError && !success) {
        console.log(`Stopping due to error on: ${email.to}`);
        break;
      }

      // Delay between emails (except after the last one)
      if (i < options.emails.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return results;
  }

  /**
   * Get email sending statistics
   */
  getStats(): { total: number; successful: number; failed: number; lastSent: string | null } {
    const logFile = join(this.logDir, 'email-sent.json');
    if (!existsSync(logFile)) {
      return { total: 0, successful: 0, failed: 0, lastSent: null };
    }

    try {
      const logs = JSON.parse(readFileSync(logFile, 'utf-8'));
      const successful = logs.filter((log: any) => log.success).length;
      const failed = logs.filter((log: any) => !log.success).length;
      const lastSent = logs.length > 0 ? logs[logs.length - 1].timestamp : null;
      
      return {
        total: logs.length,
        successful,
        failed,
        lastSent
      };
    } catch {
      return { total: 0, successful: 0, failed: 0, lastSent: null };
    }
  }

  /**
   * List all sent emails
   */
  listSent(limit = 50): Array<{ timestamp: string; to: string; subject: string; success: boolean; messageId?: string }> {
    const logFile = join(this.logDir, 'email-sent.json');
    if (!existsSync(logFile)) {
      return [];
    }

    try {
      const logs = JSON.parse(readFileSync(logFile, 'utf-8'));
      return logs.slice(-limit).reverse(); // Most recent first
    } catch {
      return [];
    }
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    const logFile = join(this.logDir, 'email-sent.json');
    if (existsSync(logFile)) {
      writeFileSync(logFile, '[]');
    }
  }

  /**
   * Create transporter from configuration
   */
  private createTransporter(config: EmailConfig): Transporter {
    // For common providers, use simplified configuration
    if (config.smtpProvider) {
      switch (config.smtpProvider.toLowerCase()) {
        case 'gmail':
          return nodemailer.createTransport({
            service: 'gmail',
            auth: {
              user: config.smtpUser,
              pass: config.smtpPassword
            }
          });
        
        case 'outlook':
        case 'office365':
          return nodemailer.createTransport({
            host: 'smtp.office365.com',
            port: 587,
            secure: false,
            auth: {
              user: config.smtpUser,
              pass: config.smtpPassword
            }
          });
        
        case 'yahoo':
          return nodemailer.createTransport({
            host: 'smtp.mail.yahoo.com',
            port: 587,
            secure: false,
            auth: {
              user: config.smtpUser,
              pass: config.smtpPassword
            }
          });
      }
    }

    // Custom SMTP configuration
    return nodemailer.createTransport({
      host: config.smtpHost || 'smtp.gmail.com',
      port: config.smtpPort || 587,
      secure: config.useSsl || false,
      requireTLS: config.useTls !== false, // default true
      auth: {
        user: config.smtpUser,
        pass: config.smtpPassword
      }
    });
  }

  /**
   * Log email sending activity
   */
  private logEmail(log: {
    to: string;
    subject: string;
    success: boolean;
    messageId?: string;
    error?: string;
    timestamp: string;
    bounced?: boolean;
    bounceReason?: string;
    permanentFailure?: boolean;
  }): void {
    const logFile = join(this.logDir, 'email-sent.json');
    let logs: any[] = [];
    
    if (existsSync(logFile)) {
      try {
        logs = JSON.parse(readFileSync(logFile, 'utf-8'));
      } catch {
        logs = [];
      }
    }
    
    logs.push(log);
    writeFileSync(logFile, JSON.stringify(logs, null, 2));
  }

  /**
   * Save a non-working email address to the bounce list
   */
  private saveNonWorkingEmail(bouncedEmail: {
    email: string;
    reason: string;
    permanent: boolean;
    timestamp: string;
    error?: string;
  }): void {
    const bounceFile = join(this.logDir, 'non-working-emails.json');
    let bouncedEmails: any[] = [];
    
    if (existsSync(bounceFile)) {
      try {
        bouncedEmails = JSON.parse(readFileSync(bounceFile, 'utf-8'));
      } catch {
        bouncedEmails = [];
      }
    }
    
    // Check if this email already exists in the bounce list
    const existingIndex = bouncedEmails.findIndex(e => e.email === bouncedEmail.email);
    
    if (existingIndex >= 0) {
      // Update existing entry
      bouncedEmails[existingIndex] = {
        ...bouncedEmails[existingIndex],
        ...bouncedEmail,
        bounceCount: (bouncedEmails[existingIndex].bounceCount || 1) + 1,
        lastBounce: bouncedEmail.timestamp
      };
    } else {
      // Add new entry
      bouncedEmails.push({
        ...bouncedEmail,
        bounceCount: 1,
        firstBounce: bouncedEmail.timestamp,
        lastBounce: bouncedEmail.timestamp
      });
    }
    
    writeFileSync(bounceFile, JSON.stringify(bouncedEmails, null, 2));
    
    // Also save to a separate permanent failures file if it's a permanent failure
    if (bouncedEmail.permanent) {
      const permanentFile = join(this.logDir, 'permanent-failures.json');
      let permanentFailures: any[] = [];
      
      if (existsSync(permanentFile)) {
        try {
          permanentFailures = JSON.parse(readFileSync(permanentFile, 'utf-8'));
        } catch {
          permanentFailures = [];
        }
      }
      
      // Check if already in permanent failures
      if (!permanentFailures.some(e => e.email === bouncedEmail.email)) {
        permanentFailures.push({
          email: bouncedEmail.email,
          reason: bouncedEmail.reason,
          timestamp: bouncedEmail.timestamp,
          error: bouncedEmail.error
        });
        
        writeFileSync(permanentFile, JSON.stringify(permanentFailures, null, 2));
      }
    }
  }

  /**
   * Get list of non-working emails
   */
  getNonWorkingEmails(): Array<{
    email: string;
    reason: string;
    permanent: boolean;
    bounceCount: number;
    firstBounce: string;
    lastBounce: string;
    error?: string;
  }> {
    const bounceFile = join(this.logDir, 'non-working-emails.json');
    
    if (!existsSync(bounceFile)) {
      return [];
    }
    
    try {
      return JSON.parse(readFileSync(bounceFile, 'utf-8'));
    } catch {
      return [];
    }
  }

  /**
   * Get list of permanent failures
   */
  getPermanentFailures(): Array<{
    email: string;
    reason: string;
    timestamp: string;
    error?: string;
  }> {
    const permanentFile = join(this.logDir, 'permanent-failures.json');
    
    if (!existsSync(permanentFile)) {
      return [];
    }
    
    try {
      return JSON.parse(readFileSync(permanentFile, 'utf-8'));
    } catch {
      return [];
    }
  }

  /**
   * Check if an email address is known to be non-working
   */
  isNonWorkingEmail(email: string): boolean {
    const nonWorking = this.getNonWorkingEmails();
    return nonWorking.some(e => e.email.toLowerCase() === email.toLowerCase());
  }

  /**
   * Clear non-working emails list
   */
  clearNonWorkingEmails(): void {
    const bounceFile = join(this.logDir, 'non-working-emails.json');
    const permanentFile = join(this.logDir, 'permanent-failures.json');
    
    if (existsSync(bounceFile)) {
      writeFileSync(bounceFile, '[]');
    }
    
    if (existsSync(permanentFile)) {
      writeFileSync(permanentFile, '[]');
    }
  }
}

// CLI helper functions
export async function handleEmailCommand(args: string[]): Promise<void> {
  const tools = new EmailTools();
  
  if (args.length === 0 || args[0] === 'help') {
    printEmailHelp();
    return;
  }

  const command = args[0];
  const remainingArgs = args.slice(1);

  switch (command) {
    case 'save':
      await handleSaveCommand(remainingArgs);
      break;

    case 'test':
      await handleTestCommand();
      break;

    case 'stats': {
      const stats = tools.getStats();
      console.log('📊 Email Statistics:');
      console.log(`Total sent: ${stats.total}`);
      console.log(`Successful: ${stats.successful}`);
      console.log(`Failed: ${stats.failed}`);
      if (stats.lastSent) {
        console.log(`Last sent: ${new Date(stats.lastSent).toLocaleString()}`);
      }
      break;
    }

    case 'list': {
      const limit = parseInt(remainingArgs[0], 10) || 10;
      const emails = tools.listSent(limit);
      console.log(`📧 Last ${limit} emails:`);
      emails.forEach((email, i) => {
        const status = email.success ? '✅' : '❌';
        console.log(`${i + 1}. ${status} ${email.to} - "${email.subject}" (${new Date(email.timestamp).toLocaleString()})`);
      });
      break;
    }

    case 'clear':
      tools.clearLogs();
      console.log('✅ Email logs cleared.');
      break;

    case 'bounces':
      await handleBouncesCommand(remainingArgs);
      break;

    case 'check':
      await handleCheckCommand(remainingArgs);
      break;

    default:
      console.log(`Unknown command: ${command}`);
      printEmailHelp();
  }
}

async function handleSaveCommand(args: string[]): Promise<void> {
  const tools = new EmailTools();
  
  // Interactive mode
  if (args.length === 0) {
    console.log('Interactive SMTP configuration setup:');
    
    const readline = await import('node:readline/promises');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    try {
      const smtpUser = await rl.question('SMTP Username/Email: ');
      const smtpPassword = await rl.question('SMTP Password/App Password: ');
      
      const smtpProvider = await rl.question('Provider (gmail, outlook, yahoo, or custom): ');
      let smtpHost = '';
      let smtpPort = '';
      let smtpFromName = '';

      if (smtpProvider.toLowerCase() === 'custom') {
        smtpHost = await rl.question('SMTP Host (e.g., smtp.gmail.com): ');
        smtpPort = await rl.question('SMTP Port (e.g., 587): ');
      }
      
      smtpFromName = await rl.question('From Name (optional): ');

      const config: EmailConfig = {
        smtpUser,
        smtpPassword,
        smtpProvider: smtpProvider.toLowerCase() === 'custom' ? undefined : smtpProvider,
        smtpHost: smtpHost || undefined,
        smtpPort: smtpPort ? parseInt(smtpPort, 10) : undefined,
        smtpFromName: smtpFromName || undefined
      };

      const success = await tools.saveConfig(config);
      if (success) {
        console.log('✅ SMTP configuration saved successfully!');
      } else {
        console.log('❌ Failed to save SMTP configuration');
      }
    } finally {
      rl.close();
    }
  } else {
    // Command line mode
    console.log('Use interactive mode for security. Run without arguments.');
    console.log('Example: agi email save');
  }
}

async function handleTestCommand(): Promise<void> {
  const tools = new EmailTools();
  console.log('Testing SMTP connection...');
  
  const result = await tools.testConnection();
  
  if (result.success) {
    console.log('✅ SMTP connection successful!');
    console.log(`Message ID: ${result.messageId}`);
    console.log(`Response: ${result.response}`);
  } else {
    console.log('❌ SMTP connection failed');
    console.log(`Error: ${result.error}`);
  }
}

async function handleBouncesCommand(args: string[]): Promise<void> {
  const tools = new EmailTools();
  
  const subCommand = args[0]?.toLowerCase() || 'list';
  
  switch (subCommand) {
    case 'list':
      const nonWorking = tools.getNonWorkingEmails();
      const permanent = tools.getPermanentFailures();
      
      console.log('📬 Non-Working Email Addresses:');
      console.log('─'.repeat(80));
      
      if (nonWorking.length === 0) {
        console.log('No non-working emails recorded.');
      } else {
        nonWorking.forEach((email, index) => {
          const status = email.permanent ? '🔴 PERMANENT' : '🟡 TEMPORARY';
          console.log(`${index + 1}. ${email.email}`);
          console.log(`   Reason: ${email.reason}`);
          console.log(`   Status: ${status}`);
          console.log(`   Bounces: ${email.bounceCount}`);
          console.log(`   First: ${new Date(email.firstBounce).toLocaleString()}`);
          console.log(`   Last: ${new Date(email.lastBounce).toLocaleString()}`);
          if (email.error) {
            console.log(`   Error: ${email.error.substring(0, 100)}${email.error.length > 100 ? '...' : ''}`);
          }
          console.log('─'.repeat(80));
        });
      }
      
      console.log('\n🔴 Permanent Failures:');
      console.log('─'.repeat(80));
      
      if (permanent.length === 0) {
        console.log('No permanent failures recorded.');
      } else {
        permanent.forEach((email, index) => {
          console.log(`${index + 1}. ${email.email}`);
          console.log(`   Reason: ${email.reason}`);
          console.log(`   Date: ${new Date(email.timestamp).toLocaleString()}`);
          if (email.error) {
            console.log(`   Error: ${email.error.substring(0, 80)}${email.error.length > 80 ? '...' : ''}`);
          }
          console.log('─'.repeat(80));
        });
      }
      break;
    
    case 'clear':
      const readline = await import('node:readline/promises');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      try {
        const answer = await rl.question('Are you sure you want to clear all bounce records? (yes/no): ');
        if (answer.toLowerCase() === 'yes') {
          tools.clearNonWorkingEmails();
          console.log('✅ Bounce records cleared.');
        } else {
          console.log('Operation cancelled.');
        }
      } finally {
        rl.close();
      }
      break;
    
    case 'stats':
      const allNonWorking = tools.getNonWorkingEmails();
      const permanentFailures = tools.getPermanentFailures();
      
      const permanentCount = allNonWorking.filter(e => e.permanent).length;
      const temporaryCount = allNonWorking.filter(e => !e.permanent).length;
      const totalBounces = allNonWorking.reduce((sum, e) => sum + e.bounceCount, 0);
      
      console.log('📊 Bounce Statistics:');
      console.log(`Total non-working emails: ${allNonWorking.length}`);
      console.log(`Permanent failures: ${permanentCount}`);
      console.log(`Temporary failures: ${temporaryCount}`);
      console.log(`Total bounce events: ${totalBounces}`);
      console.log(`Unique permanent failures: ${permanentFailures.length}`);
      
      if (allNonWorking.length > 0) {
        console.log('\n📈 Most Frequent Failures:');
        const sorted = [...allNonWorking].sort((a, b) => b.bounceCount - a.bounceCount).slice(0, 5);
        sorted.forEach((email, index) => {
          console.log(`${index + 1}. ${email.email} - ${email.bounceCount} bounce${email.bounceCount !== 1 ? 's' : ''}`);
        });
      }
      break;
    
    default:
      console.log('Usage: agi email bounces [list|clear|stats]');
      console.log('  list   - Show all non-working email addresses');
      console.log('  clear  - Clear all bounce records (requires confirmation)');
      console.log('  stats  - Show bounce statistics');
  }
}

async function handleCheckCommand(args: string[]): Promise<void> {
  const tools = new EmailTools();
  
  if (args.length === 0) {
    console.log('Usage: agi email check <email-address>');
    console.log('Example: agi email check user@example.com');
    return;
  }
  
  const email = args[0];
  const isNonWorking = tools.isNonWorkingEmail(email);
  
  console.log(`Checking email: ${email}`);
  
  if (isNonWorking) {
    const nonWorking = tools.getNonWorkingEmails();
    const emailRecord = nonWorking.find(e => e.email.toLowerCase() === email.toLowerCase());
    
    if (emailRecord) {
      console.log('❌ This email address is marked as non-working.');
      console.log(`Reason: ${emailRecord.reason}`);
      console.log(`Status: ${emailRecord.permanent ? 'PERMANENT FAILURE' : 'TEMPORARY FAILURE'}`);
      console.log(`Bounce count: ${emailRecord.bounceCount}`);
      console.log(`First bounce: ${new Date(emailRecord.firstBounce).toLocaleString()}`);
      console.log(`Last bounce: ${new Date(emailRecord.lastBounce).toLocaleString()}`);
      
      if (emailRecord.permanent) {
        console.log('⚠️  Warning: This is a permanent failure. Sending to this address will likely fail.');
      }
    }
  } else {
    console.log('✅ This email address is not marked as non-working.');
    console.log('(No bounce records found for this address)');
  }
}

function printEmailHelp(): void {
  console.log(`
AGI Email Tools - Send emails using SMTP

Commands:
  save              Configure SMTP settings interactively
  test              Test SMTP connection
  send <to> "<subject>" "<text>" [--from-name "Name"]
                    Send a single email
  bulk <emails-file.json> [--delay 5000] [--max-retries 3] [--stop-on-error]
                    Send bulk emails from JSON file
  stats             Show email sending statistics
  list [limit]      List recently sent emails (default: 10)
  clear             Clear all email logs (confirmation required)
  bounces [list|clear|stats]   Manage bounce records
  check <email>     Check if an email address is marked as non-working
  help              Show this help message

Examples:
  agi email save
  agi email test
  agi email send "user@example.com" "Test Subject" "Email body text"
  agi email send "user@example.com" "Test" "Body" --from-name "AGI System"
  agi email bulk emails.json --delay 10000
  agi email list 20
  agi email bounces list
  agi email bounces stats
  agi email check user@example.com

SMTP Configuration:
  The 'save' command will store your SMTP credentials securely in the system keychain.
  Supported providers: Gmail, Outlook/Office365, Yahoo, or custom SMTP servers.
  
  For Gmail, you need an "App Password" if 2-factor authentication is enabled.
  Generate at: https://myaccount.google.com/apppasswords

Bounce Detection:
  The system automatically detects bounced emails and saves them to a non-working list.
  Permanent failures (like invalid addresses) are marked and can be checked before sending.
  Use 'agi email bounces list' to see all non-working addresses.
  Use 'agi email check <address>' to verify if an address is known to bounce.
`);
}
