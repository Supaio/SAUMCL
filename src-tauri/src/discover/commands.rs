use futures::future;
use sjmcl_types::error::{SJMCLError, SJMCLResult};
use std::collections::HashMap;
use tauri::{AppHandle, Manager};
use tauri_plugin_http::reqwest;

use crate::discover::constants::MUA_NEWS_ENDPOINT;
use crate::discover::helpers::mc_news::{MC_NEWS_ENDPOINT, fetch_mc_news_page};
use crate::discover::models::{NewsPostRequest, NewsPostResponse, NewsSourceInfo};
use crate::utils::web::with_retry;

#[tauri::command]
pub async fn fetch_news_sources_info(app: AppHandle) -> SJMCLResult<Vec<NewsSourceInfo>> {
  let post_sources = [MUA_NEWS_ENDPOINT];

  let client = with_retry(app.state::<reqwest::Client>().inner().clone());

  let tasks: Vec<_> = post_sources
    .into_iter()
    .map(|endpoint| {
      let client = client.clone();
      let url = endpoint.to_string();
      async move {
        let mut news_source = NewsSourceInfo {
          name: "".to_string(),
          full_name: "".to_string(),
          endpoint_url: url.clone(),
          icon_src: "".to_string(),
        };

        let response = client
          .get(&url)
          .query(&[("pageSize", "0")]) // ?pageSize=0
          .send()
          .await;

        if let Ok(response) = response {
          let json_data: serde_json::Value = response.json().await.unwrap_or_default();

          if let Some(source_info) = json_data.get("sourceInfo") {
            news_source.name = source_info["name"].as_str().unwrap_or("").to_string();
            news_source.full_name = source_info["fullName"].as_str().unwrap_or("").to_string();
            news_source.icon_src = source_info["iconSrc"].as_str().unwrap_or("").to_string();
          }
        }

        news_source
      }
    })
    .collect();

  Ok(future::join_all(tasks).await)
}

#[tauri::command]
pub async fn fetch_news_post_summaries(
  app: AppHandle,
  requests: Vec<NewsPostRequest>,
) -> SJMCLResult<NewsPostResponse> {
  if requests
    .iter()
    .any(|request| request.url != MUA_NEWS_ENDPOINT && request.url != MC_NEWS_ENDPOINT)
  {
    return Err(SJMCLError("News sources are managed by SAUMCL".to_string()));
  }
  let client = with_retry(app.state::<reqwest::Client>().inner().clone());
  let tasks: Vec<_> = requests
    .into_iter()
    .map(|NewsPostRequest { url, cursor }| {
      let client = client.clone();
      async move {
        if url == MC_NEWS_ENDPOINT {
          return fetch_mc_news_page(&client, &url, cursor).await;
        }

        let mut req = client.get(&url).query(&[("pageSize", "12")]);

        if let Some(c) = cursor {
          req = req.query(&[("cursor", &c.to_string())]);
        }

        let resp = req.send().await;
        match resp {
          Ok(resp) if resp.status().is_success() => {
            let parsed: Result<NewsPostResponse, _> = resp.json().await;
            parsed.ok().map(|mut p| {
              for post in &mut p.posts {
                post.source.endpoint_url = url.clone();
              }
              (url.clone(), p)
            })
          }
          _ => None,
        }
      }
    })
    .collect();

  let results = futures::future::join_all(tasks).await;

  let mut all_posts = Vec::new();
  let mut cursors_map = HashMap::new();

  for result in results.into_iter().flatten() {
    let (url, post_response) = result;
    all_posts.extend(post_response.posts);
    if let Some(next_cursor) = post_response.next {
      cursors_map.insert(url, next_cursor);
    }
  }

  all_posts.sort_by(|a, b| b.create_at.cmp(&a.create_at));

  Ok(NewsPostResponse {
    posts: all_posts,
    next: None,
    cursors: Some(cursors_map),
  })
}
