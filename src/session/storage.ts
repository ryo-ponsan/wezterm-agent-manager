import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { InstanceData } from './instance.js';

export class Storage {
  private filePath: string;

  constructor() {
    const dir = path.join(os.homedir(), '.wezterm-agent-manager');
    this.filePath = path.join(dir, 'instances.json');
  }

  private async ensureDir(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
  }

  async load(): Promise<InstanceData[]> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed as InstanceData[];
    } catch {
      return [];
    }
  }

  async save(instances: InstanceData[]): Promise<void> {
    await this.ensureDir();
    const json = JSON.stringify(instances, null, 2);
    await fs.writeFile(this.filePath, json, 'utf-8');
  }

  async upsert(instance: InstanceData): Promise<void> {
    const instances = await this.load();
    const index = instances.findIndex((i) => i.id === instance.id);
    if (index >= 0) {
      instances[index] = instance;
    } else {
      instances.push(instance);
    }
    await this.save(instances);
  }

  async remove(id: string): Promise<void> {
    const instances = await this.load();
    const filtered = instances.filter((i) => i.id !== id);
    await this.save(filtered);
  }
}
