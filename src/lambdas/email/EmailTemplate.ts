export interface EmailTemplate {
    content: string;
    subject: string;
    requiredScopes: string[];
}