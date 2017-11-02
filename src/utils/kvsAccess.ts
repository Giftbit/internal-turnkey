import * as superagent from "superagent";

export async function kvsDelete(token: string, key: string): Promise<void> {
    await superagent.delete(`https://${process.env["LIGHTRAIL_DOMAIN"]}/v1/storage/${key}`)
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", "application/json");
}

export async function kvsGet(token: string, key: string): Promise<any> {
    const resp = await superagent.get(`https://${process.env["LIGHTRAIL_DOMAIN"]}/v1/storage/${key}`)
        .set("Authorization", `Bearer ${token}`)
        .ok(r => r.ok || r.status === 404);

    if (resp.ok) {
        return resp.body;
    }
    return null;
}

export async function kvsPut(token: string, key: string, value: any): Promise<void> {
    await superagent.put(`https://${process.env["LIGHTRAIL_DOMAIN"]}/v1/storage/${key}`)
        .set("Authorization", `Bearer ${token}`)
        .set("Content-Type", "application/json")
        .send(value);
}
