// Tipos mínimos de autocannon 8 para los escenarios de estrés (el paquete no
// publica definiciones propias).
declare module 'autocannon' {
  namespace autocannon {
    interface RequestContext {
      [key: string]: unknown;
    }

    interface Request {
      method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
      path?: string;
      headers?: Record<string, string>;
      body?: string;
      setupRequest?: (request: Request, context: RequestContext) => Request;
      onResponse?: (
        status: number,
        body: string,
        context: RequestContext,
      ) => void;
    }

    interface Options {
      url: string;
      connections?: number;
      duration?: number;
      amount?: number;
      timeout?: number;
      method?: Request['method'];
      headers?: Record<string, string>;
      body?: string;
      requests?: Request[];
    }

    interface Histogram {
      average: number;
      mean: number;
      stddev: number;
      min: number;
      max: number;
      p50: number;
      p90: number;
      p97_5: number;
      p99: number;
    }

    interface Result {
      url: string;
      requests: Histogram & { total: number; sent: number };
      latency: Histogram;
      throughput: Histogram;
      errors: number;
      timeouts: number;
      non2xx: number;
      statusCodeStats: Record<string, { count: number }>;
      duration: number;
    }

    interface Instance {
      stop(): void;
    }
  }

  function autocannon(
    options: autocannon.Options,
  ): Promise<autocannon.Result> & autocannon.Instance;

  export = autocannon;
}
