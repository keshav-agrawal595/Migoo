"use client";
import axios from 'axios';
import { useEffect, useState } from 'react';
import CourseListCard from './CourseListCard';

function CourseList() {

  const [courseList, setCourseList] = useState([]);

  useEffect(() => {
    GetCourseList();
  }, []);

  const GetCourseList = async () => {
    const result = await axios.get('/api/course');
    setCourseList(result.data);

    // Auto-generate thumbnails for courses that don't have one yet
    const coursesWithoutThumbnail = result.data.filter(
      (course: any) => !course.courseThumbnail
    );

    if (coursesWithoutThumbnail.length > 0) {
      console.log(`🖼️ Found ${coursesWithoutThumbnail.length} courses without thumbnails, generating...`);
      GenerateMissingThumbnails(coursesWithoutThumbnail);
    }
  }

  const GenerateMissingThumbnails = async (courses: any[]) => {
    for (const course of courses) {
      try {
        console.log(`🖼️ Generating thumbnail for: ${course.courseName}`);
        await axios.post('/api/generate-thumbnail', {
          courseId: course.courseId,
          courseName: course.courseName,
        });
        console.log(`✅ Thumbnail generated for: ${course.courseName}`);
      } catch (err: any) {
        console.error(`❌ Thumbnail failed for ${course.courseName}:`, err.message);
      }
    }
    // Refresh list to show newly generated thumbnails
    const refreshed = await axios.get('/api/course');
    setCourseList(refreshed.data);
  }

  return (
    <div className='max-w-6xl mt-10'>
      <h2 className="text-2xl font-bold">My Courses</h2>
      <div className='grid grid-cols-2 md:grid-cols-3 xl:grid-cols-3 gap-4'>
        {courseList.map((course: any, index: number) => (
          <CourseListCard key={index} courseItem={course} />
        ))}
      </div>
    </div>
  )
}

export default CourseList