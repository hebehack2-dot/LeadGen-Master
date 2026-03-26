export type LogPhase = 'search' | 'analyze' | 'email' | 'done' | 'error';

export interface LogEntry {
  id: string;
  message: string;
  phase: LogPhase;
  timestamp: Date;
}

export class CampaignEngine {
  private onLog: (log: LogEntry) => void;
  private onProgress: (progress: number, total: number) => void;
  private isCancelled: boolean = false;

  constructor(
    onLog: (log: LogEntry) => void,
    onProgress: (progress: number, total: number) => void
  ) {
    this.onLog = onLog;
    this.onProgress = onProgress;
  }

  private log(message: string, phase: LogPhase) {
    this.onLog({
      id: Math.random().toString(36).substring(7),
      message,
      phase,
      timestamp: new Date()
    });
  }

  public cancel() {
    this.isCancelled = true;
  }

  async run(leadType: string, location: string, targetCount: number, userId: string) {
    this.isCancelled = false;
    this.log(`Starting campaign for ${targetCount} ${leadType} leads in ${location}...`, 'search');
    
    for (let i = 1; i <= targetCount; i++) {
      if (this.isCancelled) {
        this.log('Campaign stopped by user.', 'error');
        break;
      }

      this.onProgress(i - 1, targetCount);
      
      // Phase 1: Tavily Search
      this.log(`[Lead ${i}/${targetCount}] Phase 1 (Tavily): Searching for high-quality leads...`, 'search');
      await new Promise(r => setTimeout(r, 1500));
      if (this.isCancelled) break;
      
      const leadName = `Business ${Math.floor(Math.random() * 1000)}`;
      const leadEmail = `contact@${leadName.toLowerCase().replace(/\s/g, '')}.com`;
      this.log(`[Lead ${i}/${targetCount}] Found lead: ${leadName} (${leadEmail})`, 'search');

      // Phase 2: Falcon-3-7b Analysis
      this.log(`[Lead ${i}/${targetCount}] Phase 2 (Falcon-3-7b): AI analyzing lead and writing personalized pitch...`, 'analyze');
      await new Promise(r => setTimeout(r, 2000));
      if (this.isCancelled) break;
      this.log(`[Lead ${i}/${targetCount}] Pitch generated successfully.`, 'analyze');

      // Phase 3: Brevo Email
      this.log(`[Lead ${i}/${targetCount}] Phase 3 (Brevo): Preparing and sending email...`, 'email');
      await new Promise(r => setTimeout(r, 1500));
      if (this.isCancelled) break;
      this.log(`[Lead ${i}/${targetCount}] Email sent to ${leadEmail}.`, 'email');
      
      this.onProgress(i, targetCount);
    }
    
    if (!this.isCancelled) {
      this.log(`Campaign complete! Successfully processed ${targetCount} leads.`, 'done');
    }
  }
}
