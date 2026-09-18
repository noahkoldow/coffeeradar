"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAiImage = void 0;
/** Accept a small raster attachment only. Image bytes are forwarded, never persisted or logged. */
const validateAiImage = (input) => {
    if (input == null)
        return undefined;
    if (typeof input !== 'object' || Array.isArray(input))
        throw new Error('Invalid image attachment.');
    const { mimeType, data } = input;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(String(mimeType))
        || typeof data !== 'string' || !data.length || data.length > 5_592_408
        || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
        throw new Error('Use a JPEG, PNG or WebP image no larger than 4 MB.');
    }
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length > 4 * 1024 * 1024 || bytes.toString('base64') !== data)
        throw new Error('Invalid image encoding.');
    const signatureMatches = mimeType === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : mimeType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!signatureMatches)
        throw new Error('The image format does not match its contents.');
    return { mimeType: String(mimeType), data };
};
exports.validateAiImage = validateAiImage;
