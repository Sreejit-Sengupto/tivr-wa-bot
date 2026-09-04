import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from 'ffmpeg-static';
import { Readable } from 'node:stream';
import path from 'node:path';
import fs from 'node:fs/promises';

// Configure FFmpeg binary path safely
if (ffmpegInstaller) {
    ffmpeg.setFfmpegPath(ffmpegInstaller as unknown as string);
}

interface ConvertStreamOptions {
    inputStream: ReadableStream<Uint8Array>;
    outputFileName?: string;
}

const AUDIO_DIR_NAME = 'generated-audio';

/**
 * Converts a Web ReadableStream to mono Opus .ogg and saves it under ./generated-audio/
 * @returns Relative path to the generated file (e.g., "./generated-audio/output.ogg")
 */
export async function convertStreamToOpus({
    inputStream,
    outputFileName = 'output.ogg',
}: ConvertStreamOptions): Promise<string> {
    // Paths
    const relativeFolderPath = `./${AUDIO_DIR_NAME}`;
    const relativeFilePath = `${relativeFolderPath}/${outputFileName}`;

    const absoluteFolderPath = path.resolve(process.cwd(), AUDIO_DIR_NAME);
    const absoluteFilePath = path.resolve(absoluteFolderPath, outputFileName);

    // 1. Ensure the ./generated-audio folder exists
    await fs.mkdir(absoluteFolderPath, { recursive: true });

    // 2. Convert Web Stream to Node Readable Stream
    const nodeStream = Readable.fromWeb(inputStream as any);

    // 3. Process with FFmpeg
    return new Promise((resolve, reject) => {
        ffmpeg(nodeStream)
            .audioCodec('libopus')
            .audioChannels(1)
            .outputOptions(['-avoid_negative_ts make_zero'])
            .output(absoluteFilePath)
            .on('end', () => resolve(relativeFilePath))
            .on('error', (err) => reject(err))
            .run();
    });
}

/**
 * Safely deletes a generated audio file if it exists.
 * @param filePath Relative or absolute path to the file
 */
export async function deleteAudioFile(filePath: string): Promise<void> {
    const absolutePath = path.resolve(process.cwd(), filePath);

    try {
        await fs.unlink(absolutePath);
    } catch (error) {
        // Gracefully handle case where file was already deleted or doesn't exist
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return;
        }
        throw error;
    }
}