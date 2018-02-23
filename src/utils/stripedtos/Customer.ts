import * as source from "./Source";

export interface Customer {
    id: string,
    default_source: string,
    sources: { data: source.Source[] }
}

export function toJson(customer: Customer) {
    let json = {
        id: customer.id,
        default_source: customer.default_source,
        sources: []
    };
    for (const src of customer.sources.data) {
        json.sources.push(source.toJson(src))
    }
    return json
}