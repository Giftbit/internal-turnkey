export interface Source {
    id: string,
    object: string,
    brand: string,
    exp_month: number,
    exp_year: number,
    last4: string,
}

export function toJson(source: Source) {
    return {
        id: source.id,
        object: source.object,
        brand: source.brand,
        exp_month: source.exp_month,
        exp_year: source.exp_year,
        last4: source.last4
    }
}