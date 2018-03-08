import * as source from "./Source";

export interface Customer {
    id: string;
    default_source: string;
    sources: { data: source.Source[] };
}

/**
 * Primary purpose of this method is to strip unwanted data out of what is returned from Stripe.
 * It also allows to return sources as a list of sources, rather than the object that Stripe returns.
 */
export function toJson(customer: Customer) {
    let json = {
        id: customer.id,
        default_source: customer.default_source,
        sources: []
    };
    for (const src of customer.sources.data) {
        json.sources.push(source.toJson(src));
    }
    return json;
}