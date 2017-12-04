import * as superagent from "superagent";

function storageUrl(): string {
    return `https://${process.env["LIGHTRAIL_DOMAIN"]}/v1/storage/`;
}

export async function getKey(key: string, apiKey: string): Promise<any> {
    const resp: any = await superagent.get(storageUrl() + key)
        .set("Authorization", `Bearer ${apiKey}`)
        .ok(() => true);

    return JSON.parse(resp.text);
}
