/**
 * Incremental SSE parser for orchestrator {@code oaao.stream} frames.
 *
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @param {(ev: { seq: number, eventName: string, data: Record<string, unknown> }) => void} onEvent
 * @param {AbortSignal} [signal]
 */
export async function readOaaoSseStream(reader, onEvent, signal) {
    const dec = new TextDecoder();
    let buf = '';
    let carrySeq = 0;

    const dispatchFrame = (chunkText) => {
        const lines = chunkText.split('\n');
        let idLine = 0;
        let eventName = 'message';
        const dataLines = [];
        for (const line of lines) {
            if (line.startsWith('id:')) {
                idLine = Number.parseInt(line.slice(3).trim(), 10);
                if (!Number.isFinite(idLine)) idLine = carrySeq;
            } else if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        const dataStr = dataLines.join('\n');
        /** @type {Record<string, unknown>} */
        let data = {};
        try {
            data = dataStr ? JSON.parse(dataStr) : {};
        } catch {
            data = { raw: dataStr };
        }
        const seq = idLine > 0 ? idLine : carrySeq + 1;
        carrySeq = seq;
        onEvent({ seq, eventName, data });
    };

    for (;;) {
        if (signal?.aborted) {
            try {
                await reader.cancel();
            } catch {
                /* ignore */
            }
            break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec
            .decode(value, { stream: true })
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n');
        let sep;
        while ((sep = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, sep);
            buf = buf.slice(sep + 2);
            dispatchFrame(chunk);
        }
    }
    const tail = buf.trim();
    if (tail) dispatchFrame(tail);
}
