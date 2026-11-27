// The constellations use stars from the same pool as the moving background.
(function () {
	'use strict';

	const STAR_MIN_SCALE = 1.5;
	const OVERFLOW_THRESHOLD = 1;
	const FORMATION_DURATION = 1000;
	const FLIGHT_DURATION = 800;
	const DEPARTURE_DURATION = 900;
	const IRIS_CENTER = [0.49, 0.48];
	const IRIS_RING_RADIUS = 0.13;

	const shapes = {
		personal: {
			points: [
				[0.50, 0.08], [0.58, 0.13], [0.62, 0.24], [0.61, 0.36], [0.57, 0.45],
				[0.50, 0.49], [0.43, 0.45], [0.39, 0.36], [0.38, 0.24], [0.42, 0.13],
				[0.34, 0.55], [0.24, 0.59], [0.17, 0.70], [0.16, 0.84], [0.27, 0.90],
				[0.50, 0.93], [0.73, 0.90], [0.84, 0.84], [0.83, 0.70], [0.76, 0.59],
				[0.66, 0.55], [0.50, 0.62]
			],
			edges: [
				[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 0],
				[10, 11], [11, 12], [12, 13], [13, 14], [14, 15], [15, 16], [16, 17], [17, 18],
				[18, 19], [19, 20], [20, 21], [21, 10]
			]
		},
		cv: {
			points: [
				[0.05, 0.05], [0.69, 0.05], [0.95, 0.24], [0.95, 0.95], [0.05, 0.95],
				[0.69, 0.24],
				[0.44, 0.46], [0.34, 0.42], [0.24, 0.47], [0.19, 0.59],
				[0.24, 0.71], [0.34, 0.76], [0.44, 0.72],
				[0.53, 0.42], [0.68, 0.76], [0.83, 0.42]
			],
			edges: [
				[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [1, 5], [5, 2],
				[6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [13, 14], [14, 15]
			]
		},
		games: {
			points: [[0.10, 0.68], [0.16, 0.34], [0.32, 0.25], [0.50, 0.33], [0.68, 0.25], [0.84, 0.34], [0.90, 0.68], [0.75, 0.79], [0.50, 0.64], [0.25, 0.79]],
			edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 0], [2, 8], [4, 8]]
		},
		tools: {
			points: [
				[0.370, 0.186], [0.410, 0.049], [0.590, 0.049], [0.630, 0.186],
				[0.756, 0.118], [0.882, 0.244], [0.814, 0.370], [0.951, 0.410],
				[0.951, 0.590], [0.814, 0.630], [0.882, 0.756], [0.756, 0.882],
				[0.630, 0.814], [0.590, 0.951], [0.410, 0.951], [0.370, 0.814],
				[0.244, 0.882], [0.118, 0.756], [0.186, 0.630], [0.049, 0.590],
				[0.049, 0.410], [0.186, 0.370], [0.118, 0.244], [0.244, 0.118],
				[0.500, 0.340], [0.613, 0.387], [0.660, 0.500], [0.613, 0.613],
				[0.500, 0.660], [0.387, 0.613], [0.340, 0.500], [0.387, 0.387]
			],
			edges: [
				[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8],
				[8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [14, 15], [15, 16],
				[16, 17], [17, 18], [18, 19], [19, 20], [20, 21], [21, 22], [22, 23], [23, 0],
				[24, 25], [25, 26], [26, 27], [27, 28], [28, 29], [29, 30], [30, 31], [31, 24]
			]
		},
		contact: {
			points: [
				[0.10, 0.23], [0.50, 0.23], [0.90, 0.23], [0.90, 0.77], [0.50, 0.77],
				[0.10, 0.77], [0.50, 0.53], [0.34, 0.59], [0.66, 0.59]
			],
			edges: [
				[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0],
				[0, 6], [6, 2], [5, 7], [3, 8]
			]
		},
		anime: {
			points: [
				[0.12, 0.54], [0.25, 0.38], [0.40, 0.29], [0.59, 0.28], [0.73, 0.34],
				[0.86, 0.46], [0.72, 0.65], [0.54, 0.79], [0.35, 0.76], [0.22, 0.67],
				[0.78, 0.20], [0.93, 0.30],
				[0.24, 0.22], [0.39, 0.12], [0.57, 0.11], [0.70, 0.16],
				[0.34, 0.46], [0.38, 0.61], [0.48, 0.69], [0.58, 0.65], [0.64, 0.53], [0.64, 0.38],
				IRIS_CENTER,
				...[-90, 30, 150].map(function (degrees) {
					const angle = degrees * Math.PI / 180;
					return [
						IRIS_CENTER[0] + IRIS_RING_RADIUS * Math.cos(angle),
						IRIS_CENTER[1] + IRIS_RING_RADIUS * Math.sin(angle)
					];
				})
			],
			edges: [
				[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 0],
				[4, 10], [5, 11], [12, 13], [13, 14], [14, 15],
				[2, 16], [16, 17], [17, 18], [18, 19], [19, 20], [20, 21], [21, 3]
			],
			irisCenterIndex: 22
		},
		nv194: {
			points: [
				[0.15, 0.20], [0.30, 0.13], [0.42, 0.17], [0.50, 0.27],
				[0.58, 0.17], [0.70, 0.13], [0.85, 0.20],
				[0.85, 0.71], [0.70, 0.65], [0.58, 0.70], [0.50, 0.79],
				[0.42, 0.70], [0.30, 0.65], [0.15, 0.71],
				[0.07, 0.30], [0.07, 0.82], [0.30, 0.77], [0.50, 0.90],
				[0.70, 0.77], [0.93, 0.82], [0.93, 0.30],
				[0.23, 0.36], [0.31, 0.32], [0.42, 0.38],
				[0.58, 0.38], [0.69, 0.32], [0.77, 0.36],
				[0.23, 0.51], [0.31, 0.47], [0.42, 0.53],
				[0.58, 0.53], [0.69, 0.47], [0.77, 0.51]
			],
			edges: [
				[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7],
				[7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [13, 0], [3, 10],
				[0, 14], [14, 15], [15, 16], [16, 17], [17, 18], [18, 19], [19, 20], [20, 6],
				[21, 22], [22, 23], [24, 25], [25, 26], [27, 28], [28, 29], [30, 31], [31, 32]
			]
		}
	};

	const constellationStarCount = Object.values(shapes).reduce(function (count, shape) {
		return count + shape.points.length;
	}, 0);
	// Departing constellations still hold stars when another starts forming.
	const STAR_COUNT = Math.max(constellationStarCount + 20, Math.ceil((window.innerWidth + window.innerHeight) / 8));

	const canvas = document.querySelector('body.home > canvas');
	const context = canvas.getContext('2d');
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
	const stars = [];
	let formations = [];
	let scale = 1;
	let width = 0;
	let height = 0;
	let pointerX;
	let pointerY;
	let touchInput = false;
	let touchReveal = null;
	let motionEnabled = !reducedMotion.matches;
	let frameId = null;
	const velocity = { x: 0, y: 0, tx: 0, ty: 0, z: 0.0005 };

	function generate() {
		for (let i = 0; i < STAR_COUNT; i++) {
			stars.push({
				x: 0,
				y: 0,
				z: STAR_MIN_SCALE + Math.random() * (1 - STAR_MIN_SCALE),
				opacity: 0.5 + Math.random() * 0.5,
				tailX: 0,
				tailY: 0,
				member: null
			});
		}
	}

	function placeStar(star) {
		star.x = Math.random() * width;
		star.y = Math.random() * height;
	}

	function recycleStar(star) {
		let direction = 'z';
		const vx = Math.abs(velocity.x);
		const vy = Math.abs(velocity.y);

		if (vx > 1 || vy > 1) {
			const horizontal = vx > vy
				? Math.random() < vx / (vx + vy)
				: !(Math.random() < vy / (vx + vy));
			if (horizontal) {
				direction = velocity.x > 0 ? 'l' : 'r';
			} else {
				direction = velocity.y > 0 ? 't' : 'b';
			}
		}

		star.z = STAR_MIN_SCALE + Math.random() * (1 - STAR_MIN_SCALE);
		if (direction === 'z') {
			star.z = 0.1;
			placeStar(star);
		} else if (direction === 'l' || direction === 'r') {
			star.x = direction === 'l' ? -OVERFLOW_THRESHOLD : width + OVERFLOW_THRESHOLD;
			star.y = height * Math.random();
		} else {
			star.x = width * Math.random();
			star.y = direction === 't' ? -OVERFLOW_THRESHOLD : height + OVERFLOW_THRESHOLD;
		}
	}

	function targetPosition(formation, index) {
		const rect = formation.rect;
		const point = formation.shape.points[index];
		const irisCenterIndex = formation.shape.irisCenterIndex;
		if (irisCenterIndex !== undefined && index > irisCenterIndex) {
			// Scale offsets equally on both axes to keep the ring circular.
			const center = formation.shape.points[irisCenterIndex];
			const size = Math.min(rect.width, rect.height);
			return {
				x: (rect.left + rect.width * center[0] + size * (point[0] - center[0])) * scale,
				y: (rect.top + rect.height * center[1] + size * (point[1] - center[1])) * scale
			};
		}
		return {
			x: (rect.left + rect.width * point[0]) * scale,
			y: (rect.top + rect.height * point[1]) * scale
		};
	}

	function pickStar(available, target) {
		let bestIndex = 0;
		let bestDistance = Infinity;
		available.forEach(function (star, index) {
			const distance = Math.hypot(star.x - target.x, star.y - target.y);
			if (distance < bestDistance) {
				bestIndex = index;
				bestDistance = distance;
			}
		});
		return available.splice(bestIndex, 1)[0];
	}

	function syncConstellations() {
		const nodes = Array.prototype.filter.call(
			document.querySelectorAll('[data-constellation]'),
			function (node) { return node.getClientRects().length > 0; }
		);
		if (nodes.length === formations.length && nodes.every(function (node, i) {
			return formations[i].node === node;
		})) {
			return;
		}

		formations.forEach(function (formation) {
			releaseFormation(formation, true);
		});

		formations = nodes.map(function (node) {
			const shape = shapes[node.getAttribute('data-constellation')];
			const area = node.querySelector('.constellation__sky');
			return {
				node: node,
				area: area,
				rect: area.getBoundingClientRect(),
				shape: shape,
				active: false,
				hovered: false,
				focused: false,
				tapped: false,
				state: 'idle',
				members: []
			};
		});

		if (!motionEnabled) {
			render();
		}
	}

	function releaseFormation(formation, scatter) {
		formation.members.forEach(function (member) {
			if (member.star.member === member) {
				member.star.member = null;
				member.star.tailX = 0;
				member.star.tailY = 0;
				if (scatter) {
					placeStar(member.star);
				}
			}
		});
		formation.members = [];
		formation.state = 'idle';
		formation.node.classList.remove('is-forming', 'is-ready', 'is-leaving');
	}

	function markReady(formation) {
		formation.state = 'formed';
		formation.node.classList.remove('is-forming', 'is-leaving');
		formation.node.classList.add('is-ready');
	}

	function refreshActivation(formation) {
		const active = formation.hovered || formation.focused || formation.tapped;
		if (active === formation.active) {
			return;
		}
		formation.active = active;
		formation.rect = formation.area.getBoundingClientRect();
		formation.start = performance.now();
		if (active) {
			const available = stars.filter(function (star) { return !star.member; });
			const previous = formation.members;
			formation.stagger = formation.state === 'leaving' ? 0 :
				(FORMATION_DURATION - FLIGHT_DURATION) / Math.max(1, formation.shape.points.length - 1);
			formation.members = formation.shape.points.map(function (point, index) {
				let member = previous[index];
				if (!member || member.star.member !== member) {
					const star = pickStar(available, targetPosition(formation, index));
					member = { star: star, formation: formation, point: point, index: index, progress: 0 };
					star.member = member;
				}
				member.started = false;
				member.arrived = false;
				return member;
			});
			formation.state = 'forming';
			formation.node.classList.remove('is-ready', 'is-leaving');
			formation.node.classList.add('is-forming');
		} else {
			formation.state = 'leaving';
			formation.node.classList.remove('is-forming', 'is-ready');
			formation.node.classList.add('is-leaving');
			formation.members.forEach(function (member) {
				if (member.progress === 0) {
					member.star.member = null;
					member.progress = 0;
					return;
				}
				const angle = Math.atan2(member.point[1] - 0.5, member.point[0] - 0.5) + (Math.random() - 0.5) * 0.7;
				const distance = (140 + Math.random() * 160) * scale;
				member.fromX = member.star.x;
				member.fromY = member.star.y;
				member.fromProgress = member.progress;
				member.exitX = member.fromX + Math.cos(angle) * distance;
				member.exitY = member.fromY + Math.sin(angle) * distance;
			});
		}
		if (!motionEnabled) {
			settleConstellations();
			render();
		}
	}

	function settleConstellations() {
		formations.forEach(function (formation) {
			if (!formation.active) {
				releaseFormation(formation, true);
				return;
			}
			formation.rect = formation.area.getBoundingClientRect();
			formation.members.forEach(function (member) {
				const target = targetPosition(formation, member.index);
				member.star.x = target.x;
				member.star.y = target.y;
				member.star.tailX = 0;
				member.star.tailY = 0;
				member.progress = 1;
				member.started = true;
				member.arrived = true;
			});
			if (formation.state !== 'formed') {
				markReady(formation);
			}
		});
	}

	function resize() {
		const previousWidth = width;
		const previousHeight = height;
		scale = window.devicePixelRatio || 1;
		width = window.innerWidth * scale;
		height = window.innerHeight * scale;
		canvas.width = width;
		canvas.height = height;

		stars.forEach(function (star) {
			if (!previousWidth || !previousHeight) {
				placeStar(star);
			} else {
				const xRatio = width / previousWidth;
				const yRatio = height / previousHeight;
				star.x *= xRatio;
				star.y *= yRatio;
				if (star.member && star.member.started && star.member.formation.state !== 'formed') {
					star.member.fromX *= xRatio;
					star.member.fromY *= yRatio;
					if (star.member.formation.state === 'leaving') {
						star.member.exitX *= xRatio;
						star.member.exitY *= yRatio;
					}
				}
			}
		});
		if (!motionEnabled) {
			settleConstellations();
			render();
		}
	}

	function advanceStar(star) {
		star.x += velocity.x * star.z;
		star.y += velocity.y * star.z;
		star.x += (star.x - width / 2) * velocity.z * star.z;
		star.y += (star.y - height / 2) * velocity.z * star.z;
		star.z += velocity.z;
		star.tailX = velocity.x * 0.5;
		star.tailY = velocity.y * 0.5;

		if (star.x < -OVERFLOW_THRESHOLD || star.x > width + OVERFLOW_THRESHOLD ||
			star.y < -OVERFLOW_THRESHOLD || star.y > height + OVERFLOW_THRESHOLD) {
			recycleStar(star);
		}
	}

	function update(now) {
		velocity.tx *= 0.96;
		velocity.ty *= 0.96;
		velocity.x += (velocity.tx - velocity.x) * 0.8;
		velocity.y += (velocity.ty - velocity.y) * 0.8;

		formations.forEach(function (formation) {
			formation.rect = formation.area.getBoundingClientRect();
			if (formation.state === 'forming') {
				formation.members.forEach(function (member) {
					const elapsed = now - formation.start - member.index * formation.stagger;
					if (elapsed >= 0 && !member.started && member.progress === 0) {
						// Waiting stars keep moving, so choose again when their flight starts.
						member.star.member = null;
						member.star = pickStar(stars.filter(function (star) { return !star.member; }),
							targetPosition(formation, member.index));
						member.star.member = member;
					}
				});
			}
		});
		stars.forEach(function (star) {
			const member = star.member;
			if (!member) {
				advanceStar(star);
				return;
			}

			const formation = member.formation;
			if (formation.state === 'leaving') {
				const progress = Math.max(0, Math.min(1, (now - formation.start) / DEPARTURE_DURATION));
				const eased = progress * progress * (3 - 2 * progress);
				const previousX = star.x;
				const previousY = star.y;
				star.x = member.fromX + (member.exitX - member.fromX) * eased;
				star.y = member.fromY + (member.exitY - member.fromY) * eased;
				star.tailX = (previousX - star.x) * 0.8;
				star.tailY = (previousY - star.y) * 0.8;
				member.progress = member.fromProgress * (1 - progress);
				if (progress === 1) {
					star.member = null;
				}
				return;
			}

			const target = targetPosition(formation, member.index);
			if (formation.state === 'formed') {
				star.x = target.x;
				star.y = target.y;
				star.tailX = 0;
				star.tailY = 0;
				return;
			}

			const elapsed = now - formation.start - member.index * formation.stagger;
			if (elapsed < 0) {
				if (member.progress === 0) {
					advanceStar(star);
				}
				return;
			}
			if (!member.started) {
				member.started = true;
				member.fromX = star.x;
				member.fromY = star.y;
				member.fromProgress = member.progress;
			}
			const progress = Math.min(1, elapsed / FLIGHT_DURATION);
			member.progress = member.fromProgress + (1 - member.fromProgress) * progress;
			member.arrived = progress === 1;
			const eased = 1 - Math.pow(1 - progress, 3);
			const previousX = star.x;
			const previousY = star.y;
			star.x = member.fromX + (target.x - member.fromX) * eased;
			star.y = member.fromY + (target.y - member.fromY) * eased;
			star.tailX = (previousX - star.x) * 0.8;
			star.tailY = (previousY - star.y) * 0.8;
		});

		formations.forEach(function (formation) {
			if (formation.state === 'forming' && formation.members.every(function (member) { return member.arrived; })) {
				markReady(formation);
			} else if (formation.state === 'leaving' && formation.members.every(function (member) { return member.star.member !== member; })) {
				releaseFormation(formation, false);
			}
		});
	}

	function renderIrisRing(formation, centerIndex) {
		const pupil = formation.members[centerIndex];
		let progress = pupil.progress;
		for (let index = centerIndex + 1; index < formation.members.length; index++) {
			progress = Math.min(progress, formation.members[index].progress);
		}
		const opacity = Math.max(0, (progress - 0.9) / 0.1) * 0.55;
		if (opacity === 0) {
			return;
		}

		const radius = IRIS_RING_RADIUS * Math.min(formation.rect.width, formation.rect.height) * scale;
		context.beginPath();
		context.ellipse(pupil.star.x, pupil.star.y, radius, radius, 0, 0, Math.PI * 2);
		context.lineWidth = scale;
		context.strokeStyle = 'rgba(255, 109, 136, ' + opacity + ')';
		context.shadowColor = '#ff435e';
		context.shadowBlur = 3 * scale;
		context.stroke();
	}

	function render() {
		context.clearRect(0, 0, width, height);
		context.lineCap = 'round';

		formations.forEach(function (formation) {
			if (formation.state === 'idle') {
				return;
			}
			formation.shape.edges.forEach(function (edge) {
				const first = formation.members[edge[0]];
				const second = formation.members[edge[1]];
				const progress = Math.min(first.progress, second.progress);
				const opacity = Math.max(0, (progress - 0.72) / 0.28) * 0.65;
				if (opacity === 0) {
					return;
				}
				context.beginPath();
				context.moveTo(first.star.x, first.star.y);
				context.lineTo(second.star.x, second.star.y);
				context.lineWidth = scale;
				context.strokeStyle = 'rgba(151, 181, 255, ' + opacity + ')';
				context.shadowColor = 'rgba(135, 165, 255, 0.7)';
				context.shadowBlur = 4 * scale;
				context.stroke();
			});
			if (formation.shape.irisCenterIndex !== undefined) {
				renderIrisRing(formation, formation.shape.irisCenterIndex);
			}
		});

		stars.forEach(function (star) {
			const member = star.member;
			const progress = member ? member.progress : 0;
			const emphasis = member && member.index % 3 === 0 ? 0.7 : 0;
			const irisCenterIndex = member ? member.formation.shape.irisCenterIndex : undefined;
			const irisMark = irisCenterIndex !== undefined && member.index >= irisCenterIndex;
			const ringStar = irisMark && member.index > irisCenterIndex;
			const idleRadius = 0.65 + star.z * 0.4;
			const formedRadius = irisMark ? 4.2 : idleRadius + 1.55 + emphasis;
			const radius = (idleRadius + progress * (formedRadius - idleRadius)) * scale;
			context.shadowBlur = 0;
			context.beginPath();
			context.moveTo(star.x, star.y);
			context.lineTo(star.x + star.tailX, star.y + star.tailY);
			context.lineWidth = (1 + progress) * scale;
			context.strokeStyle = 'rgba(255, 255, 255, ' + star.opacity + ')';
			context.stroke();
			context.beginPath();
			context.arc(star.x, star.y, radius, 0, Math.PI * 2);
			const color = ringStar ? '#ff8095' : '#eaf0ff';
			context.fillStyle = progress > 0 ? color : 'rgba(255, 255, 255, ' + star.opacity + ')';
			context.shadowColor = ringStar ? '#ff435e' : '#a5baff';
			context.shadowBlur = progress * (ringStar ? 3 : 12) * scale;
			context.fill();
		});
		context.shadowBlur = 0;
	}

	function step(now) {
		update(now);
		render();
		frameId = requestAnimationFrame(step);
	}

	function setMotion(enabled) {
		motionEnabled = enabled;
		document.body.classList.toggle('home--static', !enabled);
		if (frameId !== null) {
			cancelAnimationFrame(frameId);
			frameId = null;
		}
		if (motionEnabled) {
			render();
			frameId = requestAnimationFrame(step);
		} else {
			pointerX = null;
			pointerY = null;
			velocity.x = 0;
			velocity.y = 0;
			velocity.tx = 0;
			velocity.ty = 0;
			settleConstellations();
			render();
		}
	}

	function redrawIfStill() {
		if (!motionEnabled) {
			settleConstellations();
			render();
		}
	}

	function formationFor(target) {
		return formations.find(function (formation) {
			return target instanceof Node && formation.node.contains(target);
		});
	}

	function movePointer(x, y) {
		if (!motionEnabled) {
			return;
		}
		if (typeof pointerX === 'number' && typeof pointerY === 'number') {
			velocity.tx += ((x - pointerX) / 8 * scale) * (touchInput ? 1 : -1);
			velocity.ty += ((y - pointerY) / 8 * scale) * (touchInput ? 1 : -1);
		}
		pointerX = x;
		pointerY = y;
	}

	generate();
	resize();
	syncConstellations();
	setMotion(motionEnabled);

	window.addEventListener('resize', resize);
	window.addEventListener('scroll', redrawIfStill, { passive: true });
	window.addEventListener('mousemove', function (event) {
		touchInput = false;
		movePointer(event.clientX, event.clientY);
	});
	window.addEventListener('touchmove', function (event) {
		touchInput = true;
		if (event.touches.length) {
			movePointer(event.touches[0].clientX, event.touches[0].clientY);
		}
	}, { passive: true });
	window.addEventListener('touchend', function () { pointerX = null; pointerY = null; });
	document.addEventListener('mouseleave', function () { pointerX = null; pointerY = null; });
	document.addEventListener('pointerover', function (event) {
		const formation = formationFor(event.target);
		if (event.pointerType !== 'touch' && formation && !formation.node.contains(event.relatedTarget)) {
			formation.hovered = true;
			refreshActivation(formation);
		}
	});
	document.addEventListener('pointerout', function (event) {
		const formation = formationFor(event.target);
		if (event.pointerType !== 'touch' && formation && !formation.node.contains(event.relatedTarget)) {
			formation.hovered = false;
			refreshActivation(formation);
		}
	});
	document.addEventListener('pointerdown', function (event) {
		const formation = formationFor(event.target);
		// The first touch reveals the link; the next touch follows it.
		touchReveal = event.pointerType === 'touch' && formation &&
			formation.node.tagName === 'A' && !formation.tapped ? formation : null;
		formations.forEach(function (formation) {
			formation.focused = false;
			if (!formation.node.contains(event.target)) {
				formation.tapped = false;
			}
			refreshActivation(formation);
		});
	});
	document.addEventListener('pointerup', function (event) {
		const formation = formationFor(event.target);
		if (event.pointerType === 'touch' && formation) {
			formation.tapped = true;
			refreshActivation(formation);
		}
	});
	document.addEventListener('pointercancel', function () { touchReveal = null; });
	document.addEventListener('click', function (event) {
		if (touchReveal && touchReveal.node.contains(event.target)) {
			event.preventDefault();
		}
		touchReveal = null;
	});
	document.addEventListener('focusin', function (event) {
		const formation = formationFor(event.target);
		if (formation && event.target.matches(':focus-visible')) {
			formation.focused = true;
			refreshActivation(formation);
		}
	});
	document.addEventListener('focusout', function (event) {
		const formation = formationFor(event.target);
		if (formation && !formation.node.contains(event.relatedTarget)) {
			formation.focused = false;
			refreshActivation(formation);
		}
	});
	document.addEventListener('site:constellationschange', syncConstellations);
	document.addEventListener('site:langchange', redrawIfStill);
	reducedMotion.addEventListener('change', function (event) {
		setMotion(!event.matches);
	});
	if (document.fonts) {
		document.fonts.ready.then(redrawIfStill);
	}
})();
