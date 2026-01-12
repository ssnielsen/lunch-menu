#!/usr/bin/env ts-node

/**
 * Script to fetch and parse the daily lunch menu from nooncph.dk
 *
 * This script:
 * 1. Determines the current week number and day of the week
 * 2. Fetches the menu page HTML
 * 3. Finds and downloads the appropriate PDF
 * 4. Parses the PDF content (English version from page 2)
 * 5. Outputs the menu in text format
 *
 * Usage:
 *   node --experimental-strip-types scripts/fetch-lunch-menu.ts [options]
 *
 * Options:
 *   --no-allergies, -na    Remove allergy information (numbers in parentheses)
 *   --help, -h             Show help message
 *
 * Note: This script requires Node.js v22+ with experimental TypeScript support
 */

import * as cheerio from 'cheerio';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as pdf from 'pdf-parse';

type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';

/**
 * Get ISO week number for a given date
 * @param date - The date to get the week number for
 * @returns The ISO week number (1-53)
 */
function getWeekNumber(date: Date): number {
    const target = new Date(date.valueOf());
    const dayNumber = (date.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNumber + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
        target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
    }
    return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}

/**
 * Get the Danish day name and English day identifier for today
 * @returns Object with Danish day name and English identifier
 */
function getCurrentDay(): { danish: string; english: DayOfWeek } {
    const days: Array<{ danish: string; english: DayOfWeek }> = [
        { danish: 'mandag', english: 'monday' },
        { danish: 'tirsdag', english: 'tuesday' },
        { danish: 'onsdag', english: 'wednesday' },
        { danish: 'torsdag', english: 'thursday' },
        { danish: 'fredag', english: 'friday' },
    ];

    const today = new Date();
    const dayIndex = today.getDay();

    // Sunday (0) or Saturday (6) - no menu available
    if (dayIndex === 0 || dayIndex === 6) {
        throw new Error('No menu available on weekends');
    }

    // Monday is 1, Friday is 5, so subtract 1 to get array index
    return days[dayIndex - 1];
}

/**
 * Fetch HTML content from a URL
 * @param url - The URL to fetch
 * @returns Promise with the HTML content
 */
function fetchUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;

        client.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Failed to fetch ${url}: ${res.statusCode}`));
                return;
            }

            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                resolve(data);
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Download a file from a URL to a local path
 * @param url - The URL to download from
 * @param filePath - The local path to save the file
 * @returns Promise that resolves when download is complete
 */
function downloadFile(url: string, filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(filePath);

        client.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Failed to download ${url}: ${res.statusCode}`));
                return;
            }

            res.pipe(file);

            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(filePath, () => {}); // Delete the file on error
            reject(err);
        });

        file.on('error', (err) => {
            fs.unlink(filePath, () => {}); // Delete the file on error
            reject(err);
        });
    });
}

/**
 * Remove allergy information from menu text
 * @param text - The menu text with allergy info
 * @returns Text with allergy information removed
 */
function removeAllergyInfo(text: string): string {
    // Remove patterns like (3,7,12,T) or (1,12) or (K) etc.
    return text.replace(/\s*\([0-9,TKMN\s]+\)/g, '');
}

/**
 * Remove page numbers from menu text
 * @param text - The menu text with page numbers
 * @returns Text with page numbers removed
 */
function removePageNumbers(text: string): string {
    // Remove patterns like "-- 2 of 2 --" or "-- 1 of 2 --"
    return text.replace(/--\s*\d+\s+of\s+\d+\s*--/g, '').trim();
}

/**
 * Parse PDF file and extract text content (page 2 only - English menu)
 * @param filePath - Path to the PDF file
 * @returns Promise with the extracted text
 */
async function parsePdf(filePath: string): Promise<string> {
    const dataBuffer = fs.readFileSync(filePath);
    const parser = new pdf.PDFParse({ data: dataBuffer });
    // Only extract page 2 (English menu)
    const result = await parser.getText({ partial: [2] });
    await parser.destroy();
    return result.text;
}

/**
 * Find the PDF URL for today's menu from the HTML
 * @param html - The HTML content of the menu page
 * @param weekNumber - The current week number
 * @param dayName - The Danish name of the day
 * @returns The URL of the PDF or null if not found
 */
function findMenuPdfUrl(html: string, weekNumber: number, dayName: string): string | null {
    const $ = cheerio.load(html);

    // Strategy: Find all PDF links for the current day, then determine which week
    // each belongs to by looking at the last week heading that appears before it
    // in the HTML document.

    const bodyHtml = $('body').html() || html;

    // Find all PDF links for the current day and determine their week
    const candidates: Array<{ href: string; weekNum: number | null }> = [];

    $('a[href$=".pdf"]').each((_, element) => {
        const href = $(element).attr('href');
        const text = $(element).text().toLowerCase();

        if (!href) return;

        // Check if this link is for the current day
        if (!text.includes(dayName.toLowerCase()) && !href.toLowerCase().includes(dayName.toLowerCase())) {
            return;
        }

        // First check if the PDF URL itself contains the week number
        const urlWeekMatch = href.match(/(uge|week|w)[_\-\s]?(\d+)/i);
        if (urlWeekMatch) {
            candidates.push({ href, weekNum: parseInt(urlWeekMatch[2], 10) });
            return;
        }

        // Find the position of this element in the HTML
        const outerHtml = $.html(element);
        const elementPos = bodyHtml.indexOf(outerHtml);

        if (elementPos === -1) {
            candidates.push({ href, weekNum: null });
            return;
        }

        // Find the last week number mentioned before this element in the HTML
        const htmlBeforeElement = bodyHtml.substring(0, elementPos);
        const weekMatches = [...htmlBeforeElement.matchAll(/uge\s+(\d+)|week\s+(\d+)/gi)];

        let weekNum: number | null = null;
        if (weekMatches.length > 0) {
            const lastMatch = weekMatches[weekMatches.length - 1];
            weekNum = parseInt(lastMatch[1] || lastMatch[2], 10);
        }

        candidates.push({ href, weekNum });
    });

    // Find the candidate for the current week
    const match = candidates.find((c) => c.weekNum === weekNumber);
    if (match) {
        return match.href;
    }

    // Fallback: if only one candidate exists without week context, use it
    if (candidates.length === 1 && candidates[0].weekNum === null) {
        return candidates[0].href;
    }

    return null;
}

/**
 * Main function to fetch and parse today's lunch menu
 */
async function main() {
    try {
        // Parse command line arguments
        const args = process.argv.slice(2);
        const noAllergies = args.includes('--no-allergies') || args.includes('-na');

        if (args.includes('--help') || args.includes('-h')) {
            console.log('Usage: node --experimental-strip-types scripts/fetch-lunch-menu.ts [options]');
            console.log('');
            console.log('Options:');
            console.log('  --no-allergies, -na    Remove allergy information from menu');
            console.log('  --help, -h             Show this help message');
            process.exit(0);
        }

        const menuPageUrl = 'https://www.nooncph.dk/ugens-menuer';

        // Get current date info
        const today = new Date();
        const weekNumber = getWeekNumber(today);
        const currentDay = getCurrentDay();

        console.log(`Fetching menu for Week ${weekNumber}, ${currentDay.danish} (${currentDay.english})...`);
        console.log('');

        // Fetch the menu page
        console.log('Fetching menu page...');
        const html = await fetchUrl(menuPageUrl);

        // Find the PDF URL for today
        console.log('Finding PDF link...');
        const pdfUrl = findMenuPdfUrl(html, weekNumber, currentDay.danish);

        if (!pdfUrl) {
            throw new Error(`Could not find PDF for ${currentDay.danish} in week ${weekNumber}`);
        }

        // Make sure the URL is absolute
        const absolutePdfUrl = pdfUrl.startsWith('http')
            ? pdfUrl
            : `https://www.nooncph.dk${pdfUrl}`;

        console.log(`Found PDF: ${absolutePdfUrl}`);

        // Download the PDF
        const tmpDir = os.tmpdir();
        const pdfPath = path.join(tmpDir, `noon-menu-${Date.now()}.pdf`);

        console.log('Downloading PDF...');
        await downloadFile(absolutePdfUrl, pdfPath);

        // Parse the PDF
        console.log('Parsing PDF...');
        let menuText = await parsePdf(pdfPath);

        // Remove page numbers
        menuText = removePageNumbers(menuText);

        // Remove allergy info if requested
        if (noAllergies) {
            menuText = removeAllergyInfo(menuText);
        }

        // Clean up
        fs.unlinkSync(pdfPath);

        // Output the menu
        console.log('');
        console.log('='.repeat(60));
        console.log(`MENU FOR ${currentDay.danish.toUpperCase()} - WEEK ${weekNumber}`);
        console.log('='.repeat(60));
        console.log('');
        console.log(menuText);
        console.log('');
        console.log('='.repeat(60));

    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

// Run the script
main();
