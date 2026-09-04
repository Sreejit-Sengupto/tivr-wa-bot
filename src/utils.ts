import fs from 'node:fs/promises';
import path from 'node:path';

// Resolves directly to the project root directory
const ROOT_DIR = process.cwd();
const VOICE_USAGE_DIR = path.join(ROOT_DIR, 'voice-usage');
const FILE_PATH = path.join(VOICE_USAGE_DIR, 'usage.json');

export const saveAudioUsagePerDay = async (): Promise<void> => {
    const today = new Date().toISOString().split('T')[0];

    // 1. Ensure root/voice-usage folder exists
    await fs.mkdir(VOICE_USAGE_DIR, { recursive: true });

    let usageData: Record<string, number> = {};

    // 2. Read existing JSON file
    try {
        const fileContent = await fs.readFile(FILE_PATH, 'utf-8');
        usageData = JSON.parse(fileContent);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.warn('Could not read voice usage file, starting fresh:', error);
        }
    }

    // 3. Increment or initialize today's count
    usageData[today] = (usageData[today] ?? 0) + 1;

    // 4. Write back to root/voice-usage/usage.json
    await fs.writeFile(FILE_PATH, JSON.stringify(usageData, null, 2), 'utf-8');
};

export interface AudioCheckResult {
    allowed: boolean;
    message: string;
}
/**
 * Checks if daily voice generation limit has been exceeded.
 * @param upiId - The UPI ID to display in the donation message
 * @param maxLimit - The daily limit threshold (default: 5)
 */
export const shouldGenerateAudio = async (
    upiId: string = 'your-upi-id@upi',
    maxLimit: number = 5
): Promise<AudioCheckResult> => {
    const today = new Date().toISOString().split('T')[0];
    let usageData: Record<string, number> = {};

    // 1. Read existing JSON file if available
    try {
        const fileContent = await fs.readFile(FILE_PATH, 'utf-8');
        usageData = JSON.parse(fileContent);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.warn('Could not read voice usage file:', error);
        }
    }

    // 2. Check today's usage count
    const todayUsage = usageData[today] ?? 0;

    // 3. Return limit status and message
    if (todayUsage >= maxLimit) {
        return {
            allowed: false,
            message: `Limit reached for today, please donate to this UPI - ${upiId} to increase the limits`,
        };
    }

    return {
        allowed: true,
        message: `Voice generation ready. (${todayUsage}/${maxLimit} used today)`,
    };
};