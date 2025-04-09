#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as nodeJq from 'node-jq';
import {
  GitLabForkSchema,
  GitLabReferenceSchema,
  GitLabRepositorySchema,
  GitLabIssueSchema,
  GitLabMergeRequestSchema,
  GitLabContentSchema,
  GitLabCreateUpdateFileResponseSchema,
  GitLabSearchResponseSchema,
  GitLabTreeSchema,
  GitLabCommitSchema,
  CreateRepositoryOptionsSchema,
  CreateIssueOptionsSchema,
  CreateMergeRequestOptionsSchema,
  CreateBranchOptionsSchema,
  CreateOrUpdateFileSchema,
  SearchRepositoriesSchema,
  CreateRepositorySchema,
  GetFileContentsSchema,
  PushFilesSchema,
  CreateIssueSchema,
  CreateMergeRequestSchema,
  ForkRepositorySchema,
  CreateBranchSchema,
  QueryGraphQLSchema,
  type GitLabFork,
  type GitLabReference,
  type GitLabRepository,
  type GitLabIssue,
  type GitLabMergeRequest,
  type GitLabContent,
  type GitLabCreateUpdateFileResponse,
  type GitLabSearchResponse,
  type GitLabTree,
  type GitLabCommit,
  type FileOperation,
} from './schemas.js';

const server = new Server({
  name: "gitlab-mcp-server",
  version: "0.7.0",
}, {
  capabilities: {
    tools: {}
  }
});

const GITLAB_PERSONAL_ACCESS_TOKEN = process.env.GITLAB_PERSONAL_ACCESS_TOKEN;
const GITLAB_API_URL = process.env.GITLAB_API_URL || 'https://gitlab.com/api/v4';

if (!GITLAB_PERSONAL_ACCESS_TOKEN) {
  console.error("GITLAB_PERSONAL_ACCESS_TOKEN environment variable is not set");
  process.exit(1);
}

async function forkProject(
  projectId: string,
  namespace?: string
): Promise<GitLabFork> {
  const url = `${GITLAB_API_URL}/projects/${encodeURIComponent(projectId)}/fork`;
  const queryParams = namespace ? `?namespace=${encodeURIComponent(namespace)}` : '';

  const response = await fetch(url + queryParams, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GITLAB_PERSONAL_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.statusText}`);
  }

  return GitLabForkSchema.parse(await response.json());
}

async function createBranch(
  projectId: string,
  options: z.infer<typeof CreateBranchOptionsSchema>
): Promise<GitLabReference> {
  const response = await fetch(
    `${GITLAB_API_URL}/projects/${encodeURIComponent(projectId)}/repository/branches`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GITLAB_PERSONAL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        branch: options.name,
        ref: options.ref
      })
    }
  );

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.statusText}`);
  }

  return GitLabReferenceSchema.parse(await response.json());
}

async function getDefaultBranchRef(projectId: string): Promise<string> {
  const response = await fetch(
    `${GITLAB_API_URL}/projects/${encodeURIComponent(projectId)}`,
    {
      headers: {
        "Authorization": `Bearer ${GITLAB_PERSONAL_ACCESS_TOKEN}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.statusText}`);
  }

  const project = GitLabRepositorySchema.parse(await response.json());
  return project.default_branch;
}

async function getFileContents(
  projectId: string,
  filePath: string,
  ref?: string
): Promise<GitLabContent> {
  const encodedPath = encodeURIComponent(filePath);
  let url = `${GITLAB_API_URL}/projects/${encodeURIComponent(projectId)}/repository/files/${encodedPath}`;
  if (ref) {
    url += `?ref=${encodeURIComponent(ref)}`;
  }

  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${GITLAB_PERSONAL_ACCESS_TOKEN}`
    }
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.statusText}`);
  }

  const data = GitLabContentSchema.parse(await response.json());
  
  if (!Array.isArray(data) && data.content) {
    data.content = Buffer.from(data.content, 'base64').toString('utf8');
  }

  return data;
}

async function createIssue(
  projectId: string,
  options: z.infer<typeof CreateIssueOptionsSchema>
): Promise<GitLabIssue> {
  const response = await fetch(
    `${GITLAB_API_URL}/projects/${encodeURIComponent(projectId)}/issues`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GITLAB_PERSONAL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: options.title,
        description: options.description,
        assignee_ids: options.assignee_ids,
        milestone_id: options.milestone_id,
        labels: options.labels?.join(',')
      })
    }
  );

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.statusText}`);
  }

  return GitLabIssueSchema.parse(await response.json());
}

async function createMergeRequest(
  projectId: string,
  options: z.infer<typeof CreateMergeRequestOptionsSchema>
): Promise<GitLabMergeRequest> {
  const response = await fetch(
    `${GITLAB_API_URL}/projects/${encodeURIComponent(projectId)}/merge_requests`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GITLAB_PERSONAL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: options.title,
        description: options.description,
        source_branch: options.source_branch,
        target_branch: options.target_branch,
        allow_collaboration: options.allow_collaboration,
        draft: options.draft
      })
    }
  );

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.statusText}`);
  }

  return GitLabMergeRequestSchema.parse(await response.json());
}

async function createOrUpdateFile(
  projectId: string,
  filePath: string,
  content: string,
  commitMessage: string,
  branch: string,
  previousPath?: string
): Promise<GitLabCreateUpdateFileResponse> {
  const encodedPath = encodeURIComponent(filePath);
  const url = `${GITLAB_API_URL}/projects/${encodeURIComponent(projectId)}/repository/files/${encodedPath}`;

  const body = {
    branch,
    content,
    commit_message: commitMessage,
    ...(previousPath ? { previous_path: previousPath } : {})
  };

  // Check if file exists
  let method = "POST";
  try {
    await getFileContents(projectId, filePath, branch);
    method = "PUT";
  } catch (error) {
    // File doesn't exist, use POST
  }

  const response = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${GITLAB_PERSONAL_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.statusText}`);
  }

  return GitLabCreateUpdateFileResponseSchema.parse(await response.json());
}

async function createTree(
  projectId: string,
  files: FileOperation[],
  ref?: string
): Promise<GitLabTree> {
  const response = await fetch(
    `${GITLAB_API_URL}/projects/${encodeURIComponent(projectId)}/repository/tree`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GITLAB_PERSONAL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        files: files.map(file => ({
          file_path: file.path,
          content: file.content
        })),
        ...(ref ? { ref } : {})
      })
    }
  );

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.statusText}`);
  }

  return GitLabTreeSchema.parse(await response.json());
}

async function createCommit(
  projectId: string,
  message: string,
  branch: string,
  actions: FileOperation[]
): Promise<GitLabCommit> {
  const response = await fetch(
    `${GITLAB_API_URL}/projects/${encodeURIComponent(projectId)}/repository/commits`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GITLAB_PERSONAL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        branch,
        commit_message: message,
        actions: actions.map(action => ({
          action: "create",
          file_path: action.path,
          content: action.content
        }))
      })
    }
  );

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.statusText}`);
  }

  return GitLabCommitSchema.parse(await response.json());
}

async function executeGraphQLQuery(
  query: string,
  variables?: Record<string, any>,
  jqFilters?: string[]
): Promise<any> {
  const graphqlEndpoint = process.env.GITLAB_GRAPHQL_API_URL || 'https://gitlab.com/api/graphql';
  
  // Handle pagination automatically if the query contains pagination variables
  let allData: any = {};
  let hasNextPage = true;
  let endCursor: string | null = null;
  let paginatedVariables = { ...variables };
  let pageCount = 0;
  let totalItems = 0;
  const MAX_PAGES = 500;
  const MAX_ITEMS = 10000;
  const isPaginated = query.includes('pageInfo') && 
                      query.includes('hasNextPage') && 
                      query.includes('endCursor');

  while (hasNextPage && pageCount < MAX_PAGES && totalItems < MAX_ITEMS) {
    pageCount++;
    
    // Add pagination variables if query supports it
    if (isPaginated && endCursor) {
      paginatedVariables = { 
        ...paginatedVariables, 
        after: endCursor 
      };
    }

    const response = await fetch(graphqlEndpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GITLAB_PERSONAL_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query,
        variables: paginatedVariables
      })
    });

    if (!response.ok) {
      throw new Error(`GitLab GraphQL API error: ${response.statusText}`);
    }

    const result = await response.json() as { data?: any; errors?: any[] };
    if (result.errors && Array.isArray(result.errors)) {
      throw new Error(`GraphQL errors: ${JSON.stringify(result.errors)}`);
    }

    // Initialize allData with first page structure
    if (Object.keys(allData).length === 0) {
      allData = result.data;
      // Count items in the first page
      if (isPaginated) {
        const nodeCount = countNodesInGraphQLResult(result.data);
        totalItems += nodeCount;
        console.log(`Fetched page ${pageCount} with ${nodeCount} items. Total: ${totalItems}`);
      }
    } else if (result.data) {
      // Count items before merging
      if (isPaginated) {
        const nodeCount = countNodesInGraphQLResult(result.data);
        totalItems += nodeCount;
        console.log(`Fetched page ${pageCount} with ${nodeCount} items. Total: ${totalItems}`);
      }
      
      // Merge paginated results
      // Find the paginated nodes and merge them
      mergeGraphQLResults(allData, result.data);
    }

    // Check for pagination info in the result
    if (isPaginated) {
      // Find the pageInfo object in the result
      const pageInfo = findPageInfoInResult(result.data);
      if (pageInfo) {
        hasNextPage = pageInfo.hasNextPage;
        endCursor = pageInfo.endCursor;
        
        // Check if we're about to hit limits
        if (hasNextPage) {
          if (pageCount >= MAX_PAGES) {
            console.warn(`Pagination limit reached: Maximum of ${MAX_PAGES} pages. Stopping pagination.`);
            hasNextPage = false;
          } else if (totalItems >= MAX_ITEMS) {
            console.warn(`Item limit reached: Maximum of ${MAX_ITEMS} items. Stopping pagination.`);
            hasNextPage = false;
          }
        }
      } else {
        hasNextPage = false;
      }
    } else {
      // Non-paginated query, just return the first result
      hasNextPage = false;
    }
  }
  
  // Add pagination summary to the result if limits were hit
  if (isPaginated && (pageCount >= MAX_PAGES || totalItems >= MAX_ITEMS)) {
    if (!allData._paginationSummary) {
      allData._paginationSummary = {};
    }
    allData._paginationSummary = {
      pagesFetched: pageCount,
      itemsFetched: totalItems,
      limitReached: pageCount >= MAX_PAGES ? "MAX_PAGES" : "MAX_ITEMS",
      message: `Query results were truncated. Fetched ${pageCount} pages with ${totalItems} total items before hitting limit.`
    };
  }

  // Apply JQ filters if provided
  if (jqFilters && jqFilters.length > 0) {
    const fullResult = { data: allData };
    
    // Create an array for the results
    const results: Array<{result: string}> = [];
    
    for (const filter of jqFilters) {
      try {
        // Add .data prefix if not present to avoid common errors
        let safeFilter = filter;
        if (!filter.trim().startsWith('.data') && 
            !filter.trim().startsWith('{"data":')) {
          console.warn(`JQ filter does not start with .data: "${filter}". This may cause errors.`);
        }
        
        // Run the filter
        const result = await nodeJq.run(safeFilter, fullResult, { 
          input: 'json', 
          output: 'json' 
        });
        
        // Limit the size of each filter result
        const stringResult = typeof result === 'string' ? result : JSON.stringify(result);
        const truncatedResult = stringResult.substring(0, 8192); // Limit to 8K chars
        
        // Add to results array
        results.push({ result: truncatedResult });
      } catch (error) {
        console.error(`JQ filter error: ${error}`);
        results.push({ result: `Error: ${error}` });
      }
    }
    
    return {
      filteredResults: results
    };
  }

  return allData;
}

// Helper function to find pageInfo in a nested GraphQL result
function findPageInfoInResult(data: any): { hasNextPage: boolean, endCursor: string } | null {
  if (!data) return null;

  // Direct check for pageInfo at the top level
  if (data.pageInfo) {
    return data.pageInfo;
  }

  // Recursively search for pageInfo in nested objects
  for (const key in data) {
    if (typeof data[key] === 'object' && data[key] !== null) {
      // Check if this property has pageInfo
      if (data[key].pageInfo) {
        return data[key].pageInfo;
      }
      
      // Search deeper
      const pageInfo = findPageInfoInResult(data[key]);
      if (pageInfo) {
        return pageInfo;
      }
    }
  }

  return null;
}

// Helper function to count nodes in a GraphQL result
function countNodesInGraphQLResult(data: any): number {
  if (!data) return 0;
  
  let count = 0;
  
  // Look for nodes arrays in the data
  for (const key in data) {
    if (typeof data[key] === 'object' && data[key] !== null) {
      // Check if this is a nodes array
      if (key === 'nodes' && Array.isArray(data[key])) {
        count += data[key].length;
      } else {
        // Recursively search in nested objects
        count += countNodesInGraphQLResult(data[key]);
      }
    }
  }
  
  return count;
}

// Helper function to merge paginated GraphQL results
function mergeGraphQLResults(target: any, source: any) {
  if (!target || !source) return;

  for (const key in source) {
    if (source[key] && typeof source[key] === 'object') {
      if (Array.isArray(source[key])) {
        // If we found an array in the source, it might be nodes to merge
        if (!target[key]) {
          target[key] = [];
        }
        // Concat the arrays
        target[key] = target[key].concat(source[key]);
      } else if (key === 'pageInfo') {
        // Replace pageInfo with the latest one
        target[key] = source[key];
      } else if (source[key].nodes && Array.isArray(source[key].nodes)) {
        // Found a connection with nodes
        if (!target[key]) {
          target[key] = { nodes: [] };
        }
        if (!target[key].nodes) {
          target[key].nodes = [];
        }
        target[key].nodes = target[key].nodes.concat(source[key].nodes);
        
        // Update pageInfo
        if (source[key].pageInfo) {
          target[key].pageInfo = source[key].pageInfo;
        }
      } else {
        // Regular object, recursively merge
        if (!target[key]) {
          target[key] = {};
        }
        mergeGraphQLResults(target[key], source[key]);
      }
    }
  }
}

async function searchProjects(
  query: string,
  page: number = 1,
  perPage: number = 20
): Promise<GitLabSearchResponse> {
  const url = new URL(`${GITLAB_API_URL}/projects`);
  url.searchParams.append("search", query);
  url.searchParams.append("page", page.toString());
  url.searchParams.append("per_page", perPage.toString());

  const response = await fetch(url.toString(), {
    headers: {
      "Authorization": `Bearer ${GITLAB_PERSONAL_ACCESS_TOKEN}`
    }
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.statusText}`);
  }

  const projects = await response.json();
  return GitLabSearchResponseSchema.parse({
    count: parseInt(response.headers.get("X-Total") || "0"),
    items: projects
  });
}

async function createRepository(
  options: z.infer<typeof CreateRepositoryOptionsSchema>
): Promise<GitLabRepository> {
  const response = await fetch(`${GITLAB_API_URL}/projects`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${GITLAB_PERSONAL_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: options.name,
      description: options.description,
      visibility: options.visibility,
      initialize_with_readme: options.initialize_with_readme
    })
  });

  if (!response.ok) {
    throw new Error(`GitLab API error: ${response.statusText}`);
  }

  return GitLabRepositorySchema.parse(await response.json());
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_or_update_file",
        description: "Create or update a single file in a GitLab project",
        inputSchema: zodToJsonSchema(CreateOrUpdateFileSchema)
      },
      {
        name: "search_repositories",
        description: "Search for GitLab projects",
        inputSchema: zodToJsonSchema(SearchRepositoriesSchema)
      },
      {
        name: "create_repository",
        description: "Create a new GitLab project",
        inputSchema: zodToJsonSchema(CreateRepositorySchema)
      },
      {
        name: "get_file_contents",
        description: "Get the contents of a file or directory from a GitLab project",
        inputSchema: zodToJsonSchema(GetFileContentsSchema)
      },
      {
        name: "push_files",
        description: "Push multiple files to a GitLab project in a single commit",
        inputSchema: zodToJsonSchema(PushFilesSchema)
      },
      {
        name: "create_issue",
        description: "Create a new issue in a GitLab project",
        inputSchema: zodToJsonSchema(CreateIssueSchema)
      },
      {
        name: "create_merge_request",
        description: "Create a new merge request in a GitLab project",
        inputSchema: zodToJsonSchema(CreateMergeRequestSchema)
      },
      {
        name: "fork_repository",
        description: "Fork a GitLab project to your account or specified namespace",
        inputSchema: zodToJsonSchema(ForkRepositorySchema)
      },
      {
        name: "create_branch",
        description: "Create a new branch in a GitLab project",
        inputSchema: zodToJsonSchema(CreateBranchSchema)
      },
      {
        name: "query_graphql",
        description: `Execute a GraphQL query against the GitLab API with optional JQ filters for data transformation.

USAGE GUIDELINES:
- Response Structure: All GraphQL responses are wrapped in a data object. ALWAYS begin jq filters with .data
- Filter Format: Provide jqFilters as an array of strings, each containing a valid jq expression
- Null Handling: When performing math operations, filter null values first: .data.issues.nodes | map(.weight) | map(select(. != null)) | add
- Result Limiting: Raw results truncated to 8K chars, filter results to 8K chars each

QUERY CONSTRAINTS (CRITICAL):
- STRONGLY RECOMMENDED: Constrain queries to specific groups or projects rather than searching globally
- For group queries, consider using includeSubgroups: true to search across all nested projects
- Pagination Limits: Maximum of 500 pages or 10,000 items (whichever comes first) will be fetched
- Use appropriate filters in your query to narrow down results and avoid hitting pagination limits

PAGINATION (IMPORTANT):
- Automatic Pagination: If your query includes "pageInfo", "hasNextPage", and "endCursor" fields, the server will automatically fetch pages and combine them
- Pagination Structure: Use this standard pattern in your query:
  query($after: String) {
    # For a project query:
    project(fullPath: "group/project") {
      issues(first: 50, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          # fields you want
        }
      }
    }
    
    # OR for a group query with subgroups:
    group(fullPath: "top-level-group") {
      issues(first: 50, after: $after, includeSubgroups: true) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          # fields you want
        }
      }
    }
  }
- Variables: You don't need to handle the "after" variable - the server manages it automatically

COMMON PATTERNS:
- Count items: .data.project.issues.nodes | length
- Sum non-null values: .data.project.issues.nodes | map(.weight) | map(select(. != null)) | add
- Group and count: .data.project.issues.nodes | group_by(.state) | map({state: .[0].state, count: length})

Response format is an array of results: [{"result": "42"}, {"result": "[{...}]"}]`,
        inputSchema: zodToJsonSchema(QueryGraphQLSchema)
      }
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (!request.params.arguments) {
      throw new Error("Arguments are required");
    }

    switch (request.params.name) {
      case "fork_repository": {
        const args = ForkRepositorySchema.parse(request.params.arguments);
        const fork = await forkProject(args.project_id, args.namespace);
        return { content: [{ type: "text", text: JSON.stringify(fork, null, 2) }] };
      }

      case "create_branch": {
        const args = CreateBranchSchema.parse(request.params.arguments);
        let ref = args.ref;
        if (!ref) {
          ref = await getDefaultBranchRef(args.project_id);
        }

        const branch = await createBranch(args.project_id, {
          name: args.branch,
          ref
        });

        return { content: [{ type: "text", text: JSON.stringify(branch, null, 2) }] };
      }

      case "search_repositories": {
        const args = SearchRepositoriesSchema.parse(request.params.arguments);
        const results = await searchProjects(args.search, args.page, args.per_page);
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }

      case "create_repository": {
        const args = CreateRepositorySchema.parse(request.params.arguments);
        const repository = await createRepository(args);
        return { content: [{ type: "text", text: JSON.stringify(repository, null, 2) }] };
      }

      case "get_file_contents": {
        const args = GetFileContentsSchema.parse(request.params.arguments);
        const contents = await getFileContents(args.project_id, args.file_path, args.ref);
        return { content: [{ type: "text", text: JSON.stringify(contents, null, 2) }] };
      }

      case "create_or_update_file": {
        const args = CreateOrUpdateFileSchema.parse(request.params.arguments);
        const result = await createOrUpdateFile(
          args.project_id,
          args.file_path,
          args.content,
          args.commit_message,
          args.branch,
          args.previous_path
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "push_files": {
        const args = PushFilesSchema.parse(request.params.arguments);
        const result = await createCommit(
          args.project_id,
          args.commit_message,
          args.branch,
          args.files.map(f => ({ path: f.file_path, content: f.content }))
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "create_issue": {
        const args = CreateIssueSchema.parse(request.params.arguments);
        const { project_id, ...options } = args;
        const issue = await createIssue(project_id, options);
        return { content: [{ type: "text", text: JSON.stringify(issue, null, 2) }] };
      }

      case "create_merge_request": {
        const args = CreateMergeRequestSchema.parse(request.params.arguments);
        const { project_id, ...options } = args;
        const mergeRequest = await createMergeRequest(project_id, options);
        return { content: [{ type: "text", text: JSON.stringify(mergeRequest, null, 2) }] };
      }

      case "query_graphql": {
        const args = QueryGraphQLSchema.parse(request.params.arguments);
        const result = await executeGraphQLQuery(args.query, args.variables, args.jqFilters);
        
        if (args.jqFilters && result.filteredResults) {
          // Return the filtered results with each filter labeled
          return { 
            content: [{ 
              type: "text", 
              text: JSON.stringify(result.filteredResults, null, 2) 
            }] 
          };
        } else {
          // Truncate raw results to 8192 chars
          const resultJson = JSON.stringify(result, null, 2);
          const truncatedJson = resultJson.length > 8192 
            ? resultJson.substring(0, 8189) + "..." 
            : resultJson;
            
          return { content: [{ 
            type: "text", 
            text: truncatedJson 
          }] };
        }
      }

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(`Invalid arguments: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
    }
    throw error;
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("GitLab MCP Server running on stdio");
}

runServer().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});