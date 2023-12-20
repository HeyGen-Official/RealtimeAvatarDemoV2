"use strict";

// ************************************************************************
// Set your api configs below
const heygen_API = {
  'server_url': 'https://api.heygen.com',
  'upload_url': 'https://upload.heygen.com',
  'api_key': '',
  'avatar': {
    'avatar_type': 'photar',
    'photar_id': ''
  },
  'voice': {
    'voice_id': ''
  },
  'silent_video_url': 'https://resource.heygencdn.com/silent.mp4'
};
// ************************************************************************

const SERVER_URL = heygen_API.server_url;
const UPLOAD_URL = heygen_API.upload_url;
const API_KEY = heygen_API.api_key;

if (API_KEY === "" || SERVER_URL === "") {
  alert("Please enter your API key and server URL in the api.json file");
}

let sessionInfo = null;
let peerConnection = null;
let videoStream = null;
let lastBytesReceived = null;
let lastVideoState = false;
let stateID = null;
let videoComplete = false;

// selected talking photo by user
let selectedPhotoFile = null

const taskInput = document.querySelector("#taskInput");
const photarID = document.querySelector("#photarID");
const voiceID = document.querySelector("#voiceID");
const silentVideoURL = document.querySelector("#silentVideoURL");
const dimensionWidth = document.querySelector("#dimensionWidth");
const dimensionHeight = document.querySelector("#dimensionHeight");

if (heygen_API.avatar !== null && heygen_API.avatar !== undefined) {
  photarID.value = heygen_API.avatar.photar_id;
}
if (heygen_API.voice !== null && heygen_API.voice !== undefined) {
  voiceID.value = heygen_API.voice.voice_id;
}
if (heygen_API.dimension !== null && heygen_API.dimension !== undefined) {
  dimensionWidth.value = heygen_API.dimension.width;
  dimensionHeight.value = heygen_API.dimension.height;
}
if (heygen_API.silent_video_url !== null && heygen_API.silent_video_url !== undefined) {
  silentVideoURL.value = heygen_API.silent_video_url;
}

const mediaElement = document.querySelector("#mediaElement");
mediaElement.setAttribute('playsinline', '');
const silentMediaElement = document.querySelector("#silentMediaElement");
silentMediaElement.setAttribute('playsinline', '');

document
  .querySelector("#connBtn")
  .addEventListener("click", createNewSession);
document
  .querySelector("#talkBtn")
  .addEventListener("click", talkHandler);
document
  .querySelector("#closeBtn")
  .addEventListener("click", closeConnectionHandler);
document
  .querySelector('#chooser')
  .addEventListener('change', (event) => {
  const fileList = event.target.files;
  if (fileList.length > 0) {
    selectedPhotoFile = fileList[0];
  }
});
document
  .querySelector('#uploadBtn')
  .addEventListener('click', uploadTalkingHandler);
document
  .querySelector('#silentVideoBtn')
  .addEventListener('click', generateSilentVideoHandler)


const statusElement = document.querySelector("#status");
function updateStatus(statusElement, message) {
  statusElement.innerHTML += message + "<br>";
  statusElement.scrollTop = statusElement.scrollHeight;
}

updateStatus(
  statusElement,
  "You can upload your photar or create silent video before create the stream."
);

updateStatus(
  statusElement,
  "Please click the connect button to start."
);

function playTaskVideo(stream) {
  if (!stream) return;
  mediaElement.srcObject = stream;
  mediaElement.onloadedmetadata = () => {
    mediaElement.play();

    silentMediaElement.classList.remove('visible');
    mediaElement.classList.add('visible');
  };
}

function playSilentVideo() {
  silentMediaElement.src = silentVideoURL.value;

  mediaElement.classList.remove('visible');
  silentMediaElement.classList.add('visible');
}

function onTrack(event) {
  if (!event.track || event.track.kind !== "video") return;

  stateID = setInterval(async () => {
    const stats = await peerConnection.getStats(event.track);
    stats.forEach((report) => {
      if (report.type !== 'inbound-rtp' || report.mediaType !== 'video') {
        return;
      }
      const isVideoPlaying = report.bytesReceived > lastBytesReceived;
      lastBytesReceived = report.bytesReceived;

      if (isVideoPlaying === true && lastVideoState===false) {
        playTaskVideo(event.streams[0]);
        lastVideoState = true
        console.log("change to playTaskVideo")
      } else if (isVideoPlaying===false && lastVideoState===true) {
        playSilentVideo();
        lastVideoState = false
        console.log("change to playSilentVideo")
      }
    });
  }, 500);
}



function clearPeerConnection() {
  if (stateID !== null) {
    clearInterval(stateID);
    stateID = null;
  }
  if (peerConnection !== null) {
    peerConnection.close();
    peerConnection = null;
  }
}

// Create a new WebRTC session when clicking the "New" button
async function createNewSession() {
  clearPeerConnection();

  updateStatus(statusElement, "Creating new session... please wait");

  // call the new interface to get the server's offer SDP and ICE server to create a new RTCPeerConnection
  try {
    sessionInfo = await newSession("high");
  } catch (err) {
    alert("Failed to create the session, " + err.message);
    return;
  }

  const { sdp: serverSdp, ice_servers: iceServers } = sessionInfo;

  // Create a new RTCPeerConnection
  peerConnection = new RTCPeerConnection({ iceServers: iceServers });

  // When ICE candidate is available, send to the server
  peerConnection.onicecandidate = ({ candidate }) => {
    console.log("Received ICE candidate:", candidate);
    if (candidate) {
      handleICE(sessionInfo.session_id, candidate.toJSON());
    }
  };

  // When ICE connection state changes, display the new state
  peerConnection.oniceconnectionstatechange = (event) => {
    updateStatus(
      statusElement,
      `ICE connection state changed to: ${peerConnection.iceConnectionState}`
    );
    if (peerConnection.iceConnectionState === "disconnected") {
      new Promise(resolve => setTimeout(resolve, 1000));
      createNewSession();
    }
  };

  // When audio and video streams are received, display them in the video element
  peerConnection.ontrack = onTrack;

  // Set server's SDP as remote description
  const remoteDescription = new RTCSessionDescription(serverSdp);
  await peerConnection.setRemoteDescription(remoteDescription);

  updateStatus(statusElement, "Starting session... please wait");

  // Create and set local SDP description
  const localDescription = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(localDescription);

  // Start session
  try {
    await startSession(sessionInfo.session_id, localDescription);
  } catch (err) {
    alert("Failed to start the session, " + err.message);
    return;
  }

  updateStatus(statusElement, "Session started successfully");
  updateStatus(statusElement, "Session creation completed");
}


// When clicking the "Send Task" button, get the content from the input field, then send the tas
async function talkHandler() {
  if (!sessionInfo) {
    updateStatus(statusElement, "Please create a connection first");
    return;
  }
  updateStatus(statusElement, "Sending task... please wait");
  const text = taskInput.value;
  if (text.trim() === "") {
    alert("Please enter a task");
    return;
  }

  try {
    const resp = await talk(sessionInfo.session_id, text);
  } catch (err) {
    alert("Failed to send task to the session, " + err.message);
    return;
  }

  updateStatus(statusElement, "Task sent successfully");
}

// when clicking the "Close" button, close the connection
async function closeConnectionHandler() {
  silentMediaElement.src = undefined;

  if (!sessionInfo) {
    updateStatus(statusElement, "Please create a connection first");
    return;
  }
  updateStatus(statusElement, "Closing connection... please wait");
  try {
    // Close local connection
    peerConnection.close();
    // Call the close interface
    const resp = await stopSession(sessionInfo.session_id);

    console.log(resp);

    clearPeerConnection();
  } catch (err) {
    alert("Failed to close the connection, " + err.message);
    console.error("Failed to close the connection:", err);
  }
  updateStatus(statusElement, "Connection closed successfully");
}


// new session
async function newSession(quality) {
  let dimension = null;
  if (dimensionWidth.value !== "" && dimensionHeight.value !== "") {
    dimension = {
      width: Number(dimensionWidth.value),
      height: Number(dimensionHeight.value),
    }
  }
  const body = {
    quality,
    avatar: {
      avatar_type: "photar",
      photar_id: photarID.value,
    },
    voice: {
      voice_id: voiceID.value,
    },
    dimension,
  };
  const response = await fetch(`${SERVER_URL}/v2/realtime/new`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY,
    },
    body: JSON.stringify(body),
  });
  if (response.status === 500) {
    updateStatus(
      statusElement,
      "Server Error. Please ask the staff if the service has been turned on"
    );
    throw new Error("Server error");
  } else if (response.status === 400) {
    const data = await response.json();
    throw new Error(data.error.message);
  } else {
    const data = await response.json();
    console.log(data.data);
    return data.data;
  }
}

// start the session
async function startSession(session_id, sdp) {
  const response = await fetch(`${SERVER_URL}/v2/realtime/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY,
    },
    body: JSON.stringify({ session_id, sdp }),
  });
  if (response.status === 500) {
    console.error("Server error");
    updateStatus(
      statusElement,
      "Server Error. Please ask the staff if the service has been turned on"
    );
    throw new Error("Server error");
  } else if (response.status === 400) {
    const data = await response.json();
    throw new Error(data.error.message);
  } else {
    const data = await response.json();
    return data.data;
  }
}

// submit the ICE candidate
async function handleICE(session_id, candidate) {
  const response = await fetch(`${SERVER_URL}/v2/realtime/ice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY,
    },
    body: JSON.stringify({ session_id, candidate }),
  });
  if (response.status === 500) {
    console.error("Server error");
    updateStatus(
      statusElement,
      "Server Error. Please ask the staff if the service has been turned on"
    );
    throw new Error("Server error");
  } else if (response.status === 400) {
    const data = await response.json();
    throw new Error(data.error.message);
  } else {
    const data = await response.json();
    return data;
  }
}

async function talk(session_id, text) {
  const response = await fetch(`${SERVER_URL}/v2/realtime/task`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY,
    },
    body: JSON.stringify({ session_id, text }),
  });
  if (response.status === 500) {
    console.error("Server error");
    updateStatus(
      statusElement,
      "Server Error. Please ask the staff if the service has been turned on"
    );
    throw new Error("Server error");
  } else if (response.status === 400) {
    const data = await response.json();
    throw new Error(data.error.message);
  } else {
    const data = await response.json();
    return data.data;
  }
}

// stop session
async function stopSession(session_id) {
  const response = await fetch(`${SERVER_URL}/v2/realtime/stop`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY,
    },
    body: JSON.stringify({ session_id }),
  });
  if (response.status === 500) {
    console.error("Server error");
    updateStatus(statusElement, "Server Error. Please ask the staff for help");
    throw new Error("Server error");
  } else if (response.status === 400) {
    const data = await response.json();
    throw new Error(data.error.message);
  } else {
    const data = await response.json();
    return data.data;
  }
}

async function uploadTalkingHandler(){
  if(selectedPhotoFile === null){
    return alert('Please choose talking photo')
  }
  updateStatus(statusElement, "Uploading talking photo...");
  const response = await fetch(`${UPLOAD_URL}/v1/talking_photo`,{
    method:'POST',
    headers: {
      "X-Api-Key": API_KEY,
      "content-type": selectedPhotoFile.type,
    },
    body: new Blob([selectedPhotoFile], { type: selectedPhotoFile.type }),
  })
  if (response.status === 500) {
    console.error("Server error");
    updateStatus(statusElement, "Server Error. Upload failed");
    throw new Error("Server error");
  }

  const {data} = await response.json()
  console.log(data)

  photarID.value = data.talking_photo_id

  updateStatus(statusElement, "Upload talking photo successfully, photar_id is " + data.talking_photo_id);
  updateStatus(statusElement, "You can create silent video or start video stream now");
}

async function generateSilentVideoHandler(){
  updateStatus(statusElement, "Start generate silent video...");
  const response = await fetch(`${SERVER_URL}/v2/video/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": API_KEY,
    },
    body: JSON.stringify(
        {
          "video_inputs": [
            {
              "character": {"type":"talking_photo","talking_photo_id":photarID.value},
              "voice":{"type":"audio","audio_url": "https://resource.heygencdn.com/silent.mp3"}}
          ],
          "dimension": {"width": 300, "height": 300}
        }
    ),
  });
  if (response.status === 500) {
    console.error("Server error");
    updateStatus(statusElement, "Server Error. Please ask the staff for help");
    throw new Error("Server error");
  } else {
    const {data} = await response.json();
    silentVideoURL.value = await getPublicUrl(data.video_id)
    playSilentVideo();

    updateStatus(statusElement, "Generate silent video successfully, video_id is " + data.video_id);
    updateStatus(statusElement, "video_url is " + silentVideoURL.value);
    updateStatus(statusElement, "You can start video stream now");
  }
}

async function getPublicUrl(video_id){
  while(true){
    await new Promise(resolve => setTimeout(resolve, 1000));
    const response = await fetch(`${SERVER_URL}/v1/video_status.get?video_id=${video_id}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": API_KEY,
      },
    });
    if (response.status === 500) {
      updateStatus(statusElement, "Server error, Please retry later");
      throw new Error("Server error")
    }
    const {data} = await response.json()
    if(data.status === "completed"){
      return data.video_url
    }else if(data.status === "processing"){
      updateStatus(statusElement, "Processing...");
    }
  }
}
