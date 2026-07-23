/** Shape of user LLM/GitHub settings — stored client-side in localStorage only. */
export type UserSettings = {
    github_token?: string;
    llm_provider?: string;
    anthropic_api_key?: string;
    anthropic_model?: string;
    groq_api_key?: string;
    groq_model?: string;
    ollama_host?: string;
    ollama_model?: string;
    vertex_project_id?: string;
    vertex_region?: string;
    vertex_model?: string;
    vertex_sa_key?: string;
    vllm_host?: string;
    vllm_model?: string;
    vllm_api_key?: string;
};
