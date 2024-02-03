const clientId = "937e986831994af6afd8c3f765e1d591";
const params = new URLSearchParams(window.location.search);
const code = params.get("code");

if (!code) {
  redirectToAuthCodeFlow(clientId);
} else {
  const accessToken = await getAccessToken(clientId, code);
  await copyOnRepeatSongs(accessToken);
}

async function copyOnRepeatSongs(token: string) {
  const messages: any[] = [];
  const { id: userId } = await fetchProfile(token);
  const onRepeatSongs = await getOnRepeatSongs(userId, token);
  const monthlyPlaylist = await getMonthlyPlaylist(userId, token, messages);
  await addSongsToPlaylist(monthlyPlaylist, onRepeatSongs, token, messages);
  updateUI(messages);
}

function updateUI(messages: string[]) {
  document.getElementById("result")!.innerText = messages.join("\n");
}

async function getPlaylist(userId: string, token: string, pred: any) {
  let ret = null;
  let url = `https://api.spotify.com/v1/users/${userId}/playlists`;
  while (url && !ret) {
    const result = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    const { next, items } = await result.json();
    url = next;
    ret = items.find(pred);
  }
  return ret;
}

async function getPlaylistSongs(playlistId: string, token: string) {
  let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks`;
  const trackSet: Set<any> = new Set();
  while (url) {
    const result = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await result.json();
    url = data.next;
    data.items?.forEach((track: any) => {
      trackSet.add(track);
    });
  }
  return trackSet;
}

async function addSongsToPlaylist(
  newPlaylist: any,
  trackMap: Map<string, string>,
  token: string,
  messages: string[]
) {
  let url = `https://api.spotify.com/v1/playlists/${newPlaylist}/tracks`;
  while (url) {
    const result = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await result.json();
    url = data.next;
    data.items?.forEach(({ track }: any) => trackMap.delete(track.uri));
  }
  if (!trackMap.size) {
    messages.push("No new songs to add");
    return;
  }
  const songNames = Array.from(trackMap.values());
  messages.push(`Added the following songs: ${songNames.join(";")}`);

  const result = await fetch(
    `https://api.spotify.com/v1/playlists/${newPlaylist}/tracks`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        uris: Array.from(trackMap.keys()),
      }),
    }
  );
  await result.json();
}

async function getOnRepeatSongs(userId: string, token: string) {
  const onRepeat = await getPlaylist(
    userId,
    token,
    (p: any) => p.owner.id === "spotify" && p.name === "On Repeat"
  );
  const onRepeatSongs = await getPlaylistSongs(onRepeat.id, token);
  const trackSet = new Map<string, string>();
  onRepeatSongs.forEach(({ track }: any) =>
    trackSet.set(track.uri, track.name)
  );
  return trackSet;
}

async function getMonthlyPlaylist(
  userId: string,
  token: string,
  messages: string[]
) {
  const newPlaylistName = getCurrentPlaylistName();
  let newPlaylist = await getPlaylist(
    userId,
    token,
    (p: any) => p.name === newPlaylistName
  );

  if (newPlaylist) {
    messages.push(`Used existing playlist: ${newPlaylistName}`);
    return newPlaylist.id;
  }
  messages.push(`Created new playlist: ${newPlaylistName}`);

  const result = await fetch(
    `https://api.spotify.com/v1/users/${userId}/playlists`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: newPlaylistName,
        description: "",
        public: false,
      }),
    }
  );

  newPlaylist = await result.json();
  return newPlaylist.id;
}

function getCurrentPlaylistName() {
  const currentDate = new Date();
  const month = (currentDate.getMonth() + 1).toString().padStart(2, "0"); // Adding 1 because months are zero-based
  const year = currentDate.getFullYear().toString().slice(-2); // Extracting the last two digits of the year
  return `${month}/${year} - Repeat`;
}

export async function redirectToAuthCodeFlow(clientId: string) {
  const verifier = generateCodeVerifier(128);
  const challenge = await generateCodeChallenge(verifier);

  localStorage.setItem("verifier", verifier);

  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append("response_type", "code");
  params.append("redirect_uri", "http://localhost:5173/callback");
  params.append(
    "scope",
    "user-read-private playlist-modify-private playlist-modify playlist-read-private"
  );
  params.append("code_challenge_method", "S256");
  params.append("code_challenge", challenge);

  document.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

function generateCodeVerifier(length: number) {
  let text = "";
  let possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  for (let i = 0; i < length; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

async function generateCodeChallenge(codeVerifier: string) {
  const data = new TextEncoder().encode(codeVerifier);
  const digest = await window.crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function getAccessToken(
  clientId: string,
  code: string
): Promise<string> {
  const verifier = localStorage.getItem("verifier");

  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append("grant_type", "authorization_code");
  params.append("code", code);
  params.append("redirect_uri", "http://localhost:5173/callback");
  params.append("code_verifier", verifier!);

  const result = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  const { access_token } = await result.json();
  return access_token;
}

async function fetchProfile(token: string): Promise<any> {
  const result = await fetch("https://api.spotify.com/v1/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  return await result.json();
}
