const TODOIST_BASE = 'https://api.todoist.com/api/v1';

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function apiFetch(token, path, options = {}) {
  const res = await fetch(`${TODOIST_BASE}${path}`, {
    ...options,
    headers: { ...headers(token), ...(options.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Todoist API ${options.method ?? 'GET'} ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

function unwrap(data) {
  // Todoist v1 may wrap arrays: { results: [...] }
  if (data && Array.isArray(data.results)) return data.results;
  if (Array.isArray(data)) return data;
  return [];
}

export async function getProjectId(token, projectName) {
  const data = await apiFetch(token, '/projects');
  const projects = unwrap(data);
  const match = projects.find(
    (p) => p.name.toLowerCase() === projectName.toLowerCase()
  );
  if (!match) {
    throw new Error(`Todoist project "${projectName}" not found`);
  }
  return match.id;
}

export async function getOrCreateSection(token, projectId, sectionName) {
  const data = await apiFetch(token, `/sections?project_id=${projectId}`);
  const sections = unwrap(data);
  const existing = sections.find(
    (s) => s.name.toLowerCase() === sectionName.toLowerCase()
  );
  if (existing) return existing.id;

  const created = await apiFetch(token, '/sections', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, name: sectionName }),
  });
  return created.id;
}

export async function createTask(token, { content, description, projectId, sectionId }) {
  const body = {
    content,
    description,
    project_id: projectId,
    ...(sectionId ? { section_id: sectionId } : {}),
  };
  const task = await apiFetch(token, '/tasks', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return task;
}
