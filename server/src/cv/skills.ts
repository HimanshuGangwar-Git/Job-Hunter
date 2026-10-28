// Skill taxonomy used for extraction from CVs and job descriptions.
// Each entry is [canonical name, ...aliases]. Aliases are matched on word boundaries, case-insensitively.
const TAXONOMY: [string, ...string[]][] = [
  ['JavaScript', 'JS', 'ES6', 'ECMAScript'],
  ['TypeScript', 'TS'],
  ['Python'],
  ['Java'],
  ['Kotlin'],
  ['Golang'],
  ['Rust'],
  ['C++'],
  ['C#', 'CSharp', 'C Sharp'],
  ['Ruby'],
  ['PHP'],
  ['Scala'],
  ['Swift'],
  ['SQL'],
  ['React', 'React.js', 'ReactJS'],
  ['Next.js', 'NextJS'],
  ['Vue.js', 'Vue', 'VueJS'],
  ['Angular', 'AngularJS'],
  ['Svelte'],
  ['Redux'],
  ['HTML', 'HTML5'],
  ['CSS', 'CSS3'],
  ['Tailwind CSS', 'Tailwind'],
  ['Sass', 'SCSS'],
  ['Webpack'],
  ['Vite'],
  ['Storybook'],
  ['Jest'],
  ['Vitest'],
  ['Cypress'],
  ['Playwright'],
  ['Selenium'],
  ['Node.js', 'NodeJS', 'Node'],
  ['Express.js', 'ExpressJS'],
  ['Fastify'],
  ['NestJS'],
  ['Django'],
  ['Flask'],
  ['FastAPI'],
  ['Spring Boot', 'Spring'],
  ['REST APIs', 'REST API', 'RESTful', 'RESTful APIs'],
  ['GraphQL'],
  ['gRPC'],
  ['WebSocket', 'WebSockets'],
  ['PostgreSQL', 'Postgres'],
  ['MySQL'],
  ['MongoDB', 'Mongo'],
  ['Redis'],
  ['Elasticsearch'],
  ['Kafka', 'Apache Kafka'],
  ['RabbitMQ'],
  ['Snowflake'],
  ['Apache Spark', 'PySpark'],
  ['Airflow', 'Apache Airflow'],
  ['Tableau'],
  ['Power BI', 'PowerBI'],
  ['Excel'],
  ['Pandas'],
  ['NumPy'],
  ['Machine Learning', 'ML'],
  ['Deep Learning'],
  ['TensorFlow'],
  ['PyTorch'],
  ['NLP', 'Natural Language Processing'],
  ['LangChain'],
  ['Docker'],
  ['Kubernetes', 'K8s'],
  ['Terraform'],
  ['Ansible'],
  ['AWS', 'Amazon Web Services'],
  ['Azure', 'Microsoft Azure'],
  ['GCP', 'Google Cloud', 'Google Cloud Platform'],
  ['Linux'],
  ['Git', 'GitHub', 'GitLab'],
  ['CI/CD', 'CI CD', 'Continuous Integration'],
  ['Jenkins'],
  ['Microservices', 'Micro-services', 'Microservice'],
  ['Micro-frontends', 'Micro frontends', 'Microfrontends'],
  ['Figma'],
  ['Accessibility', 'WCAG', 'a11y'],
  ['Design Systems', 'Design System'],
  ['Agile', 'Scrum'],
  ['Jira'],
  ['Data Structures', 'Algorithms'],
  ['System Design'],
  ['Distributed Systems'],
  ['Data Pipelines', 'ETL', 'ELT'],
  ['Java EE'],
  ['Hibernate'],
  ['Unity'],
  ['Salesforce'],
  ['SAP'],
  ['Selenium WebDriver'],
  ['Performance Optimization', 'Web Performance'],
  ['Test Automation', 'Unit Testing'],
  ['Product Management'],
  ['Stakeholder Management'],
  ['D3.js', 'D3'],
  ['Chart.js'],
  ['Recharts'],
];

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Matcher {
  canonical: string;
  pattern: RegExp;
}

const MATCHERS: Matcher[] = TAXONOMY.map(([canonical, ...aliases]) => {
  const names = [canonical, ...aliases].map(escape).sort((a, b) => b.length - a.length);
  // Lookarounds stop "Java" matching inside "JavaScript" and "Go" matching inside "Google".
  return {
    canonical,
    pattern: new RegExp(`(?<![A-Za-z0-9+#])(?:${names.join('|')})(?![A-Za-z0-9+#])`, 'i'),
  };
});

const CANONICAL_BY_LOWER = new Map<string, string>(TAXONOMY.map(([c]) => [c.toLowerCase(), c]));

/** Returns canonical skill names mentioned in free text, in taxonomy order, without duplicates. */
export function findSkills(text: string): string[] {
  if (!text) return [];
  return MATCHERS.filter((m) => m.pattern.test(text)).map((m) => m.canonical);
}

/** Normalises a free-text skill (e.g. "react js") to its canonical name when known, otherwise trims it. */
export function canonicalSkill(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  const direct = CANONICAL_BY_LOWER.get(trimmed.toLowerCase());
  if (direct) return direct;
  const found = findSkills(trimmed);
  return found.length === 1 ? found[0] : trimmed;
}

export function isKnownSkill(name: string): boolean {
  return CANONICAL_BY_LOWER.has(name.toLowerCase());
}
